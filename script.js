// ===================== CONFIG - coloque aqui seu URL do Apps Script =====================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec"; // <<-- substitua
// =======================================================================================

let state = { raw: null, chart: null };

// perguntas (textos EXATOS que aparecem nas chaves do JSON)
const QUESTIONS = [
  "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
  "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];

// abreviações (eixo X)
const ABBR = ["Autocontrole", "Nomear emoções", "Autoconfiança", "Relacionamento"];

// mapeamento emoji -> rótulo
const EMOJI_MAP = { "😞": "Ruim", "😬": "Regular", "🙂": "Bom", "😀": "Ótimo" };
const CATEGORY_ORDER = ["😞","😬","🙂","😀"];
const CATEGORY_COLORS = {
  "😞": "rgba(220,53,69,0.9)",
  "😬": "rgba(255,159,64,0.9)",
  "🙂": "rgba(255,205,86,0.9)",
  "😀": "rgba(75,192,192,0.9)"
};

// chaves em avaliacao
const KEY_REC = "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?";
const KEY_AUTO = "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?";
const KEY_PROF1 = "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?";
const KEY_PROF2 = "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?";

// DOM helpers
const q = id => document.getElementById(id);
const setText = (id, txt) => { const el = q(id); if (el) el.textContent = txt; };
const setHTML = (id, html) => { const el = q(id); if (el) el.innerHTML = html; };

// fetch
async function fetchExec() {
  try {
    const url = APPSCRIPT_URL + "?_ts=" + Date.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return await res.json();
  } catch (err) {
    console.error("Erro fetchExec:", err);
    alert("Erro ao buscar dados: " + err.message);
    return null;
  }
}

// populates selects
function populateFilters(raw) {
  const combine = (raw.checkin||[]).concat(raw.checkout||[]).concat(raw.avaliacao||[]);
  const turmas = Array.from(new Set(combine.map(r => r["Turma"]).filter(Boolean))).sort();
  const eixos  = Array.from(new Set(combine.map(r => r["Eixo"]).filter(Boolean))).sort();
  const months = Array.from(new Set(combine.map(r => r["Timestamp"] || r["Carimbo de data/hora"]).filter(Boolean))).sort();

  const selTurma = q("sel-turma");
  const selEixo  = q("sel-eixo");
  const selMonth = q("sel-month");

  [selTurma, selEixo, selMonth].forEach(sel => {
    while (sel.options.length > 1) sel.remove(1);
  });

  turmas.forEach(t => selTurma.add(new Option(t,t)));
  eixos.forEach(e => selEixo.add(new Option(e,e)));
  months.forEach(m => selMonth.add(new Option(m,m)));
}

// apply filters
function applyFilters(rows) {
  if (!rows) return [];
  const turma = q("sel-turma").value;
  const eixo  = q("sel-eixo").value;
  const month = q("sel-month").value;
  return rows.filter(r => {
    if (turma !== "Todos" && (r["Turma"]||"") !== turma) return false;
    if (eixo  !== "Todos" && (r["Eixo"]||"") !== eixo) return false;
    const ts = r["Timestamp"] || r["Carimbo de data/hora"] || "";
    if (month !== "Todos" && ts !== month) return false;
    return true;
  });
}

// detecta emoji no começo do texto
function detectEmoji(text) {
  if (!text) return null;
  const s = text.toString().trim();
  const first = s[0];
  if (EMOJI_MAP[first]) return first;
  for (const em of Object.keys(EMOJI_MAP)) if (s.indexOf(em) >= 0) return em;
  return null;
}

// conta por categoria para uma pergunta (separa checkin e checkout)
function countCategories(rows, questionKey) {
  const counts = {};
  CATEGORY_ORDER.forEach(e => counts[e] = 0);
  (rows || []).forEach(r => {
    const raw = (r[questionKey] || "").toString().trim();
    if (!raw) return;
    const em = detectEmoji(raw);
    if (em && counts[em] !== undefined) counts[em] = counts[em] + 1;
  });
  return counts;
}

// plugin para desenhar números dentro das fatias/barras
const barValuePlugin = {
  id: 'barValuePlugin',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta || !meta.data) return;
      meta.data.forEach((bar, index) => {
        const val = dataset.data[index];
        if (val === 0 || val === null || val === undefined) return;
        // bar is a Rectangle element
        const box = bar;
        const x = box.x;
        const y = (box.y + box.base) / 2; // middle of segment
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // if segment is too small, draw above segment
        const height = Math.abs(box.base - box.y);
        if (height < 14) {
          ctx.fillStyle = '#000';
          ctx.fillText(val.toString(), x, box.y - 8);
        } else {
          ctx.fillText(val.toString(), x, y);
        }
        ctx.restore();
      });
    });
  }
};

// build chart with two stacks: 'checkin' and 'checkout'
function buildCompareChart(labels, datasets) {
  const ctx = q("chart-compare").getContext("2d");
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { precision:0 } }
      }
    },
    plugins: [barValuePlugin]
  });

  // render legend custom (only 4 categories)
  renderLegend();
}

function renderLegend() {
  const el = q("legend-compare");
  el.innerHTML = "";
  CATEGORY_ORDER.forEach(em => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = CATEGORY_COLORS[em];
    const txt = document.createElement("span");
    txt.textContent = `${em} ${EMOJI_MAP[em]}`;
    item.appendChild(sw);
    item.appendChild(txt);
    el.appendChild(item);
  });
}

// utilidades numéricas
function asNumber(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const s = v.toString().trim().replace(",",".");
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}
function calcAverage(rows, key) {
  const vals = (rows||[]).map(r => asNumber(r[key])).filter(n => !isNaN(n));
  if (!vals.length) return null;
  const sum = vals.reduce((a,b)=>a+b,0);
  return sum / vals.length;
}

// Cálculo NPS (porcentagem e retorno nps)
function computeNPSPercent(rows, key) {
  const vals = (rows||[]).map(r => asNumber(r[key])).filter(n => !isNaN(n));
  const total = vals.length;
  if (!total) return { total:0, detratores:0, neutros:0, promotores:0, pctDetr:0, pctProm:0, nps: null };
  let detr = 0, neut = 0, prom = 0;
  vals.forEach(v => {
    if (v <= 6) detr++;
    else if (v <= 8) neut++;
    else prom++;
  });
  const pctDetr = (detr / total) * 100;
  const pctProm = (prom / total) * 100;
  const nps = pctProm - pctDetr;
  return { total, detratores: detr, neutros: neut, promotores: prom, pctDetr, pctProm, nps };
}

// format AI summary (keep and persist)
function formatAISummary(rawText) {
  if (!rawText) return "Sem conteúdo da IA.";
  let s = rawText.replace(/—/g, "-").replace(/\r/g, "");
  const blocks = s.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const htmlBlocks = blocks.map(block => {
    const headingMatch = block.match(/^#{1,6}\s*(.+)$/m);
    if (headingMatch) {
      const title = headingMatch[1].trim();
      const rest = block.replace(/^#{1,6}\s*.+\n?/, "").trim();
      const paras = rest.split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join("");
      return `<p><strong>${escapeHtml(title)}</strong></p>${paras}`;
    } else {
      const paras = block.split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join("");
      return paras;
    }
  });
  return htmlBlocks.join("<br/>");
}
function escapeHtml(text) {
  return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// localStorage helpers for AI persistence
const AI_STORAGE_KEY = "dashboard_ai_summary_v1";
function saveAISummary(html) {
  try { localStorage.setItem(AI_STORAGE_KEY, html || ""); } catch(e){/*ignore*/}
}
function loadAISummary() {
  try { return localStorage.getItem(AI_STORAGE_KEY); } catch(e){ return null; }
}

// shorten labels
function shorten(s, max=60) {
  if (!s) return s;
  if (s.length <= max) return s;
  const cut = s.slice(0,max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 10 ? cut.slice(0,lastSpace) : cut) + '...';
}

// render principal (executado apenas quando usuário clicar Atualizar)
async function renderAll() {
  const data = await fetchExec();
  if (!data) return;
  const raw = data.raw || {};
  state.raw = raw;

  setText("last-update", "Última: " + new Date().toLocaleString());

  populateFilters(raw);

  // filtros aplicados
  const checkinFiltered = applyFilters(raw.checkin || []);
  const checkoutFiltered = applyFilters(raw.checkout || []);
  const avaliacaoFiltered = applyFilters(raw.avaliacao || []);

  // montar datasets:
  // Para cada categoria (😞,😬,🙂,😀) criamos 2 datasets: uma para CHECKIN (stack 'checkin') e outra para CHECKOUT (stack 'checkout').
  // Cada dataset terá data com 4 valores (uma por pergunta).
  const labels = ABBR.slice(); // ["Autocontrole", ...]
  const datasets = [];

  CATEGORY_ORDER.forEach(cat => {
    // checkin dataset
    const dataCheckin = QUESTIONS.map(qk => {
      const c = countCategories(checkinFiltered, qk);
      return c[cat] || 0;
    });
    datasets.push({
      label: `${cat} ${EMOJI_MAP[cat]} (Check-in)`,
      data: dataCheckin,
      backgroundColor: CATEGORY_COLORS[cat],
      stack: 'checkin'
    });

    // checkout dataset
    const dataCheckout = QUESTIONS.map(qk => {
      const c = countCategories(checkoutFiltered, qk);
      return c[cat] || 0;
    });
    datasets.push({
      label: `${cat} ${EMOJI_MAP[cat]} (Check-out)`,
      data: dataCheckout,
      backgroundColor: CATEGORY_COLORS[cat],
      stack: 'checkout'
    });
  });

  buildCompareChart(labels, datasets);

  // NPS (avaliacao)
  const npsObj = computeNPSPercent(avaliacaoFiltered, KEY_REC);
  setText("metric-nps-rec", npsObj.nps === null ? "—" : (Math.round(npsObj.nps * 10)/10).toFixed(1));

  const avgAuto = calcAverage(avaliacaoFiltered, KEY_AUTO);
  const avgProf1 = calcAverage(avaliacaoFiltered, KEY_PROF1);
  const avgProf2 = calcAverage(avaliacaoFiltered, KEY_PROF2);

  setText("metric-nps-auto", avgAuto === null ? "—" : avgAuto.toFixed(2));
  setText("metric-nps-prof1", avgProf1 === null ? "—" : avgProf1.toFixed(2));
  setText("metric-nps-prof2", avgProf2 === null ? "—" : avgProf2.toFixed(2));

  // AI: ONLY update ai-summary if backend actually returned ai.
  // Otherwise keep existing summary (from prior Generate or localStorage).
  if (data.ai) {
    const html = formatAISummary(data.ai.resumo || data.ai.text || JSON.stringify(data.ai));
    setHTML("ai-summary", html);
    saveAISummary(html);
  } else {
    // if current element is default text and we have stored AI, load it
    const cur = (q("ai-summary").textContent || "").trim();
    if ((!cur || cur.startsWith("Clique em")) && loadAISummary()) {
      setHTML("ai-summary", loadAISummary());
    }
    // otherwise, keep whatever is already in ai-summary (persistence achieved)
  }
}

// INSIGHTS: chama Apps Script action=insights e substitui o resumo (salva em localStorage)
async function fetchInsights() {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: Date.now() });
    const turma = q("sel-turma").value; if (turma !== "Todos") params.set("turma", turma);
    const eixo  = q("sel-eixo").value;  if (eixo !== "Todos")  params.set("eixo", eixo);
    const month = q("sel-month").value; if (month !== "Todos") params.set("month", month);
    const url = APPSCRIPT_URL + "?" + params.toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    con
