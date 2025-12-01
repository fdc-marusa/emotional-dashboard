// ===================== CONFIG - coloque aqui seu URL do Apps Script =====================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec"; // <<-- substitua
const AUTO_REFRESH_SECONDS = 45; // polling
// =======================================================================================

let state = { raw: null, chart: null };

// perguntas (textos EXATOS como aparecem nas chaves do JSON)
const QUESTIONS = [
  "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
  "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];

// mapeamento de emoji -> rótulo curto (usado no gráfico/legenda)
const EMOJI_MAP = {
  "😞": "Ruim",
  "😬": "Regular",
  "🙂": "Bom",
  "😀": "Ótimo"
};
// cores por categoria (mesma ordem usada para datasets)
const CATEGORY_ORDER = ["😞","😬","🙂","😀"];
const CATEGORY_COLORS = {
  "😞": "rgba(220,53,69,0.9)",   // vermelho
  "😬": "rgba(255,159,64,0.9)",  // laranja
  "🙂": "rgba(255,205,86,0.9)",  // amarelo
  "😀": "rgba(75,192,192,0.9)"   // verde
};

// chaves das perguntas NPS / avaliacao (EXATAS)
const KEY_REC = "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?";
const KEY_AUTO = "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?";
const KEY_PROF1 = "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?";
const KEY_PROF2 = "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?";

// DOM helpers
const q = id => document.getElementById(id);
const setText = (id, txt) => { const el = q(id); if (el) el.textContent = txt; };
const setHTML = (id, html) => { const el = q(id); if (el) el.innerHTML = html; };

// fetch dos dados
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

// populate filters
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

// detecta emoji inicial e retorna categoria (Ruim/Regular/Bom/Ótimo) e emoji
function detectCategoryFromText(text) {
  if (!text) return null;
  const s = text.toString().trim();
  // verificar primeiro caractere (emoji comum)
  const first = s[0];
  if (EMOJI_MAP[first]) return { emoji: first, label: EMOJI_MAP[first] };
  // caso emoji seguido por espaço: verificar first two runes
  // fallback: procurar qualquer emoji em string
  for (const em of Object.keys(EMOJI_MAP)) {
    if (s.indexOf(em) >= 0) return { emoji: em, label: EMOJI_MAP[em] };
  }
  // se nada encontrado
  return null;
}

// conta por categoria (para uma pergunta) em combinedRows (checkin+checkout)
function countCategoriesForQuestion(combinedRows, questionKey) {
  const counts = {};
  CATEGORY_ORDER.forEach(em => counts[em] = 0);
  (combinedRows || []).forEach(row => {
    const raw = (row[questionKey] || "").toString().trim();
    if (!raw) return;
    const cat = detectCategoryFromText(raw);
    if (cat) counts[cat.emoji] = (counts[cat.emoji] || 0) + 1;
  });
  return counts; // object with emoji keys
}

// build stacked bar chart
function buildCompareChart(labels, datasetsData) {
  const ctx = q("chart-compare").getContext("2d");
  if (state.chart) state.chart.destroy();

  state.chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: datasetsData },
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
    }
  });

  renderLegendCompare(datasetsData);
}

function renderLegendCompare(datasetsData) {
  const el = q("legend-compare");
  el.innerHTML = "";
  datasetsData.forEach(ds => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = ds.backgroundColor;
    const txt = document.createElement("span");
    txt.textContent = ds.label;
    item.appendChild(sw);
    item.appendChild(txt);
    el.appendChild(item);
  });
}

// cálculos numéricos
function asNumber(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const s = v.toString().trim().replace(",","." );
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}
function calcAverage(rows, key) {
  const vals = (rows||[]).map(r => asNumber(r[key])).filter(n => !isNaN(n));
  if (!vals.length) return null;
  const sum = vals.reduce((a,b)=>a+b,0);
  return sum / vals.length;
}

// CALCULO NPS (segundo sua formula)
// retorna objeto { total, detratores, neutros, promotores, pctDetr, pctProm, nps }
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

// formata AI summary (parágrafos, ### -> bold)
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

// shorten labels do eixo x
function shorten(s, max=70) {
  if (!s) return s;
  if (s.length <= max) return s;
  const cut = s.slice(0,max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 10 ? cut.slice(0,lastSpace) : cut) + '...';
}

// RENDER PRINCIPAL
async function renderAll() {
  const data = await fetchExec();
  if (!data) return;
  const raw = data.raw || {};
  state.raw = raw;

  setText("last-update", "Última: " + new Date().toLocaleString());

  populateFilters(raw);

  // aplicar filtros
  const checkinFiltered = applyFilters(raw.checkin || []);
  const checkoutFiltered = applyFilters(raw.checkout || []);
  const avaliacaoFiltered = applyFilters(raw.avaliacao || []);

  const combined = checkinFiltered.concat(checkoutFiltered);

  // montar datasets: para cada categoria (ORDERED) temos array de counts por pergunta
  const labels = QUESTIONS.map(q => shorten(q, 66));
  const datasets = CATEGORY_ORDER.map(catEmoji => {
    const dataPerQ = QUESTIONS.map(qk => {
      const counts = countCategoriesForQuestion(combined, qk);
      return counts[catEmoji] || 0;
    });
    return {
      label: `${catEmoji} ${EMOJI_MAP[catEmoji]}`,
      data: dataPerQ,
      backgroundColor: CATEGORY_COLORS[catEmoji],
      stack: 'stack1'
    };
  });

  buildCompareChart(labels, datasets);

  // NPS: usar computeNPSPercent e exibir nps (valor)
  const npsObj = computeNPSPercent(avaliacaoFiltered, KEY_REC);
  setText("metric-nps-rec", npsObj.nps === null ? "—" : (Math.round(npsObj.nps * 10)/10).toFixed(1));

  // medias professor1/prof2/auto
  const avgAuto = calcAverage(avaliacaoFiltered, KEY_AUTO);
  const avgProf1 = calcAverage(avaliacaoFiltered, KEY_PROF1);
  const avgProf2 = calcAverage(avaliacaoFiltered, KEY_PROF2);

  setText("metric-nps-auto", avgAuto === null ? "—" : avgAuto.toFixed(2));
  setText("metric-nps-prof1", avgProf1 === null ? "—" : avgProf1.toFixed(2));
  setText("metric-nps-prof2", avgProf2 === null ? "—" : avgProf2.toFixed(2));

  // AI summary if backend returned it
  if (data.ai) {
    setHTML("ai-summary", formatAISummary(data.ai.resumo || data.ai.text || JSON.stringify(data.ai)));
  } else {
    setText("ai-summary", "Clique em 'Gerar Insights IA' para solicitar um resumo.");
  }
}

// INSIGHTS (chama action=insights)
async function fetchInsights() {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: Date.now() });
    const turma = q("sel-turma").value; if (turma !== "Todos") params.set("turma", turma);
    const eixo  = q("sel-eixo").value;  if (eixo !== "Todos")  params.set("eixo", eixo);
    const month = q("sel-month").value; if (month !== "Todos") params.set("month
