// ===================== CONFIG - URL do Apps Script =====================
const APPSCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec";
// =======================================================================

let state = { raw: null, chart: null };

// perguntas (textos EXATOS)
const QUESTIONS = [
  "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
  "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];

// abreviações
const ABBR = ["Autocontrole", "Nomear emoções", "Autoconfiança", "Relacionamento"];

// mapeamento de respostas por categoria
const EMOJI_MAP = { "😞": "Ruim", "😬": "Regular", "🙂": "Bom", "😀": "Ótimo" };
const CATEGORY_ORDER = ["😞", "😬", "🙂", "😀"];
const CATEGORY_COLORS = {
  "😞": "rgba(220,53,69,0.9)",
  "😬": "rgba(255,159,64,0.9)",
  "🙂": "rgba(255,205,86,0.9)",
  "😀": "rgba(75,192,192,0.9)"
};

// chaves avaliacao
const KEY_REC =
  "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?";
const KEY_AUTO =
  "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?";
const KEY_PROF1 =
  "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?";
const KEY_PROF2 =
  "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?";

// ------------------ DOM helpers ------------------
const q = (id) => document.getElementById(id);
const setText = (id, txt) => { q(id).textContent = txt; };
const setHTML = (id, html) => { q(id).innerHTML = html; };

// ------------------ Fetch ------------------
async function fetchExec() {
  try {
    const url = APPSCRIPT_URL + "?_ts=" + Date.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error("Erro: " + res.status);
    return await res.json();
  } catch (err) {
    console.error(err);
    alert("Erro ao buscar dados do servidor.");
    return null;
  }
}

// ------------------ Populate Filters ------------------
function populateFilters(raw) {
  const combine = (raw.checkin || []).concat(raw.checkout || [], raw.avaliacao || []);

  const turmas = [...new Set(combine.map(r => r["Turma"]).filter(Boolean))].sort();
  const eixos = [...new Set(combine.map(r => r["Eixo"]).filter(Boolean))].sort();
  const months = [...new Set(combine.map(r => r["Timestamp"] || r["Carimbo de data/hora"]).filter(Boolean))];

  const selTurma = q("sel-turma");
  const selEixo = q("sel-eixo");
  const selMonth = q("sel-month");

  [selTurma, selEixo, selMonth].forEach(select => {
    while (select.options.length > 1) select.remove(1);
  });

  turmas.forEach(t => selTurma.add(new Option(t, t)));
  eixos.forEach(e => selEixo.add(new Option(e, e)));
  months.forEach(m => selMonth.add(new Option(m, m)));
}

// ------------------ Apply Filters ------------------
function applyFilters(rows) {
  const t = q("sel-turma").value;
  const e = q("sel-eixo").value;
  const m = q("sel-month").value;

  return rows.filter(r => {
    if (t !== "Todos" && r["Turma"] !== t) return false;
    if (e !== "Todos" && r["Eixo"] !== e) return false;
    const ts = r["Timestamp"] || r["Carimbo de data/hora"];
    if (m !== "Todos" && ts !== m) return false;
    return true;
  });
}

// ------------------ Emoji detect ------------------
function detectEmoji(text) {
  if (!text) return null;
  const s = text.toString().trim();
  const first = s[0];
  if (EMOJI_MAP[first]) return first;
  for (const e of CATEGORY_ORDER) if (s.includes(e)) return e;
  return null;
}

// ------------------ Count categories ------------------
function countCategories(rows, question) {
  const obj = { "😞": 0, "😬": 0, "🙂": 0, "😀": 0 };
  rows.forEach(r => {
    const raw = r[question];
    const em = detectEmoji(raw);
    if (em) obj[em]++;
  });
  return obj;
}

// ------------------ Chart plugin ------------------
const barValuePlugin = {
  id: "barValuePlugin",
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((ds, dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      if (!meta) return;
      meta.data.forEach((bar, index) => {
        const val = ds.data[index];
        if (!val) return;

        const x = bar.x;
        const y = (bar.y + bar.base) / 2;
        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const height = Math.abs(bar.base - bar.y);
        if (height < 14) {
          ctx.fillStyle = "#000";
          ctx.fillText(val, x, bar.y - 6);
        } else {
          ctx.fillText(val, x, y);
        }

        ctx.restore();
      });
    });
  }
};

// ------------------ Build Compare Chart ------------------
function buildCompareChart(labels, datasets) {
  if (state.chart) state.chart.destroy();
  const ctx = q("chart-compare").getContext("2d");

  state.chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
      plugins: { legend: { display: false } }
    },
    plugins: [barValuePlugin]
  });

  renderLegend();
}

function renderLegend() {
  const el = q("legend-compare");
  el.innerHTML = "";
  CATEGORY_ORDER.forEach(em => {
    el.innerHTML += `
      <div class="legend-item">
        <span class="legend-swatch" style="background:${CATEGORY_COLORS[em]}"></span>
        ${em} ${EMOJI_MAP[em]}
      </div>`;
  });
}

// ------------------ Averages ------------------
function asNumber(v) {
  if (typeof v === "number") return v;
  if (!v) return NaN;
  return Number(v.toString().replace(",", ".")) || NaN;
}

function calcAverage(rows, key) {
  const nums = rows.map(r => asNumber(r[key])).filter(n => !isNaN(n));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ------------------ NPS ------------------
function computeNPSPercent(rows, key) {
  const nums = rows.map(r => asNumber(r[key])).filter(n => !isNaN(n));
  const total = nums.length;
  if (!total) return { nps: null };

  let detr = 0, neut = 0, prom = 0;
  nums.forEach(v => {
    if (v <= 6) detr++;
    else if (v <= 8) neut++;
    else prom++;
  });

  const pctDetr = (detr / total) * 100;
  const pctProm = (prom / total) * 100;
  return { nps: pctProm - pctDetr };
}

// ------------------ AI Summary Persistence ------------------
const AI_STORAGE_KEY = "dashboard_ai_summary_v1";

function saveAISummary(html) {
  localStorage.setItem(AI_STORAGE_KEY, html);
}

function loadAISummary() {
  return localStorage.getItem(AI_STORAGE_KEY);
}

// ------------------ Render All ------------------
async function renderAll() {
  const data = await fetchExec();
  if (!data) return;
  const raw = data.raw || {};
  state.raw = raw;

  setText("last-update", "Última atualização: " + new Date().toLocaleString());

  populateFilters(raw);

  const checkin = applyFilters(raw.checkin || []);
  const checkout = applyFilters(raw.checkout || []);
  const avaliacao = applyFilters(raw.avaliacao || []);

  const labels = ABBR;

  const datasets = [];
  CATEGORY_ORDER.forEach(em => {
    datasets.push({
      label: `${em} (Check-in)`,
      data: QUESTIONS.map(q => countCategories(checkin, q)[em]),
      backgroundColor: CATEGORY_COLORS[em],
      stack: "checkin"
    });

    datasets.push({
      label: `${em} (Check-out)`,
      data: QUESTIONS.map(q => countCategories(checkout, q)[em]),
      backgroundColor: CATEGORY_COLORS[em],
      stack: "checkout"
    });
  });

  buildCompareChart(labels, datasets);

  const nps = computeNPSPercent(avaliacao, KEY_REC);
  setText("metric-nps-rec", nps.nps !== null ? nps.nps.toFixed(1) : "—");

  setText("metric-nps-auto", (calcAverage(avaliacao, KEY_AUTO) || "—").toString().slice(0, 4));
  setText("metric-nps-prof1", (calcAverage(avaliacao, KEY_PROF1) || "—").toString().slice(0, 4));
  setText("metric-nps-prof2", (calcAverage(avaliacao, KEY_PROF2) || "—").toString().slice(0, 4));

  const stored = loadAISummary();
  if (stored) setHTML("ai-summary", stored);
}

// ------------------ Fetch Insights ------------------
async function fetchInsights() {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: Date.now() });
    const turma = q("sel-turma").value;
    if (turma !== "Todos") params.set("turma", turma);
    const eixo = q("sel-eixo").value;
    if (eixo !== "Todos") params.set("eixo", eixo);
    const month = q("sel-month").value;
    if (month !== "Todos") params.set("month", month);

    const url = APPSCRIPT_URL + "?" + params.toString();
    const res = await fetch(url);
    const json = await res.json();

    const text = json.ai?.resumo || json.ai?.text || json.text || "Sem conteúdo.";
    setHTML("ai-summary", text);
    saveAISummary(text);
  } catch (e) {
    alert("Erro ao gerar insights.");
  }
}

// ------------------ Events ------------------
q("btn-refresh").addEventListener("click", renderAll);
q("btn-insights").addEventListener("click", fetchInsights);

// ------------------ Auto Refresh (45s) ------------------
setInterval(() => {
  renderAll(); // NÃO ATUALIZA IA
}, 45000);

// ------------------ Initial Load ------------------
window.addEventListener("load", () => {
  const saved = loadAISummary();
  if (saved) setHTML("ai-summary", saved);
  renderAll();
});
