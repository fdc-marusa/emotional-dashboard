// =============================
// CONFIG
// =============================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec";
const AUTO_REFRESH_MS = 45000;

// perguntas fixas
const QUESTIONS = [
  "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
  "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];

// abreviações que aparecem no gráfico
const ABBR = [
  "Autocontrole",
  "Nomear emoções",
  "Autoconfiança",
  "Relacionamento"
];

// categorias / emojis
const CATEGORY_ORDER = ["😞","😬","🙂","😀"];
const CATEGORY_LABEL = {
  "😞":"Ruim",
  "😬":"Regular",
  "🙂":"Bom",
  "😀":"Ótimo"
};
const CATEGORY_COLOR = {
  "😞":"rgba(220,53,69,0.9)",
  "😬":"rgba(255,159,64,0.9)",
  "🙂":"rgba(255,205,86,0.9)",
  "😀":"rgba(75,192,192,0.9)"
};

// onde salvamos o texto da IA
const AI_KEY = "dashboard_ai_summary_v2";

let chartCheckin = null;
let chartCheckout = null;
let autoTimer = null;

// =======================================================
// HELPERS
// =======================================================
const $ = id => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };

// normaliza string
function normalizeText(s) {
  if (!s) return "";
  return s
    .toString()
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9\s"']/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// keywords por pergunta
const Q_TOKENS = [
  ["desestabiliz","autocontrol","autocontrole","desestabiliza"],
  ["nomear","emoc","de boa","deboa"],
  ["autoconfian","autoconfiança","autoconfiante","confian"],
  ["relacion","equipe","trabalhar em equipe","relacionamento"]
];

// acha resposta para uma pergunta
function findResponseForQuestion(row, qIndex) {
  const canonical = QUESTIONS[qIndex];
  if (row.hasOwnProperty(canonical)) return row[canonical];

  for (const key of Object.keys(row)) {
    const k = normalizeText(key);
    for (const token of Q_TOKENS[qIndex]) {
      if (k.includes(token)) return row[key];
    }
  }

  return null;
}

// extrai emoji
function extractEmoji(value) {
  if (!value) return null;
  const s = value.toString();
  for (const em of CATEGORY_ORDER) {
    if (s.includes(em)) return em;
  }
  return null;
}

// =======================================================
// FETCH & FILTERS
// =======================================================
async function fetchRaw() {
  try {
    const res = await fetch(APPSCRIPT_URL + "?_ts=" + Date.now());
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    console.error("fetchRaw error:", e);
    alert("Erro ao buscar dados.");
    return null;
  }
}

// converte Timestamp → "YYYY-MM"
function extractMonth(r) {
  const ts = r["Timestamp"] || r["Carimbo de data/hora"];
  if (!ts) return null;

  const d = new Date(ts);
  if (isNaN(d)) return null;

  return d.toISOString().slice(0, 7); // ex: "2025-08"
}

function populateFilters(raw) {
  const combine = (raw.checkin || []).concat(raw.checkout || []).concat(raw.avaliacao || []);

  const turmas = Array.from(new Set(combine.map(r => r["Turma"]).filter(Boolean))).sort();
  const eixos  = Array.from(new Set(combine.map(r => r["Eixo"]).filter(Boolean))).sort();
  const months = Array.from(new Set(combine.map(extractMonth).filter(Boolean))).sort();

  const selT = $("sel-turma");
  const selE = $("sel-eixo");
  const selM = $("sel-month");

  [selT, selE, selM].forEach(s => { while (s.options.length > 1) s.remove(1); });

  turmas.forEach(t => selT.add(new Option(t, t)));
  eixos.forEach(e => selE.add(new Option(e, e)));
  months.forEach(m => selM.add(new Option(m, m)));
}

function applyFilters(rows) {
  if (!rows) return [];

  const selT = $("sel-turma").value;
  const selE = $("sel-eixo").value;
  const selM = $("sel-month").value;

  return rows.filter(r => {
    if (selT !== "Todos" && (r["Turma"] || "") !== selT) return false;
    if (selE !== "Todos" && (r["Eixo"] || "") !== selE) return false;

    const month = extractMonth(r);
    if (selM !== "Todos" && month !== selM) return false;

    return true;
  });
}

// =======================================================
// AGGREGATION
// =======================================================
function countCategoriesForRows(rows) {
  const out = QUESTIONS.map(() => {
    const base = {};
    CATEGORY_ORDER.forEach(e => base[e] = 0);
    return base;
  });

  rows.forEach(r => {
    QUESTIONS.forEach((q, qi) => {
      const v = findResponseForQuestion(r, qi);
      const em = extractEmoji(v);
      if (em && out[qi][em] !== undefined) out[qi][em]++;
    });
  });

  return out;
}

// =======================================================
// CHARTS
// =======================================================
const barValuePlugin = {
  id: 'barValuePlugin',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      meta.data.forEach((bar, idx) => {
        const val = ds.data[idx];
        if (!val) return;

        ctx.save();
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const x = bar.x;
        const y = bar.y - 10;
        ctx.fillStyle = "#000";
        ctx.fillText(val, x, y);
        ctx.restore();
      });
    });
  }
};

function renderLegend(id) {
  const el = $(id);
  el.innerHTML = "";
  CATEGORY_ORDER.forEach(em => {
    const d = document.createElement("div");
    d.className = "legend-item";

    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = CATEGORY_COLOR[em];

    d.appendChild(sw);
    d.appendChild(document.createTextNode(`${em} ${CATEGORY_LABEL[em]}`));

    el.appendChild(d);
  });
}

function createChart(canvasId, legendId, countsArray) {
  const labels = ABBR.slice();

  const datasets = CATEGORY_ORDER.map(em => ({
    label: CATEGORY_LABEL[em],
    data: countsArray.map(q => q[em] || 0),
    backgroundColor: CATEGORY_COLOR[em]
  }));

  const ctx = $(canvasId).getContext("2d");

  if (canvasId === "chart-checkin" && chartCheckin) chartCheckin.destroy();
  if (canvasId === "chart-checkout" && chartCheckout) chartCheckout.destroy();

  const chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { stacked: false }, y: { beginAtZero: true } }
    },
    plugins: [barValuePlugin]
  });

  renderLegend(legendId);

  if (canvasId === "chart-checkin") chartCheckin = chart;
  if (canvasId === "chart-checkout") chartCheckout = chart;
}

// =======================================================
// NPS & MÉDIAS
// =======================================================
function asNumber(v) {
  if (typeof v === "number") return v;
  if (!v) return NaN;
  const n = Number(v.toString().trim().replace(",", "."));
  return isNaN(n) ? NaN : n;
}

function computeNPS(rows, key) {
  const vals = rows.map(r => asNumber(r[key])).filter(n => !isNaN(n));
  const total = vals.length;
  if (!total) return { nps: null, pctDet: 0, pctPro: 0 };

  const detratores = vals.filter(v => v >= 0 && v <= 6).length;
  const neutros = vals.filter(v => v === 7 || v === 8).length;
  const promotores = vals.filter(v => v === 9 || v === 10).length;

  const pctDet = (detratores / total) * 100;
  const pctPro = (promotores / total) * 100;
  const nps = pctPro - pctDet;

  return { nps, pctDet, pctPro };
}

function average(rows, key) {
  const vals = rows.map(r => asNumber(r[key])).filter(n => !isNaN(n));
  if (!vals.length) return null;
  return vals.reduce((a,b)=>a+b,0) / vals.length;
}

// =======================================================
// AI SUMMARY — leve e bem humorado
// =======================================================
function escapeHtml(t) {
  return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function toneFromAverage(avg) {
  if (avg >= 4.5) return "Top! 🎉";
  if (avg >= 3.5) return "Boa! 😄";
  if (avg >= 2.5) return "Ok 😐";
  return "Precisa melhorar 😬";
}

function formatAI(raw, avaliacao) {
  if (!raw) return "Nenhum insight ainda. Clique no botão ☝️";

  let s = raw.replace(/—/g,"-").replace(/\r/g,"").trim();
  const parts = s.split(/\n+/).filter(Boolean);

  let out = [];
  parts.forEach(p => out.push(`<p>${escapeHtml(p)}</p>`));

  const avg1 = average(avaliacao, "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?");
  const avg2 = average(avaliacao, "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?");

  out.push(`<br><p><strong>👨‍🏫 Avaliação dos Professores</strong></p>`);
  if (avg1 !== null) out.push(`<p>Professor 1: ${avg1.toFixed(1)} — ${toneFromAverage(avg1)}</p>`);
  if (avg2 !== null) out.push(`<p>Professor 2: ${avg2.toFixed(1)} — ${toneFromAverage(avg2)}</p>`);

  out.push(`<br><p>✨ Continui mandando bem! 😄</p>`);

  return out.join("");
}

// =======================================================
// INSIGHTS VIA APPSCRIPT
// =======================================================
async function fetchInsights() {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: Date.now() });

    const t = $("sel-turma").value;
    const e = $("sel-eixo").value;
    const m = $("sel-month").value;

    if (t !== "Todos") params.set("turma", t);
    if (e !== "Todos") params.set("eixo", e);
    if (m !== "Todos") params.set("month", m);

    const res = await fetch(APPSCRIPT_URL + "?" + params.toString());
    if (!res.ok) throw new Error(res.status);

    const json = await res.json();
    const txt = json.ai?.resumo || json.text || "";

    const formatted = formatAI(txt, json.raw?.avaliacao || []);
    localStorage.setItem(AI_KEY, formatted);

    $("insightBox").innerHTML = formatted;

  } catch (err) {
    console.error(err);
    alert("Erro ao gerar insights (backend).");
  }
}

// =======================================================
// RENDER ALL
// =======================================================
async function renderAll() {
  const json = await fetchRaw();
  if (!json || !json.raw) return;

  const raw = json.raw;

  setText("last-update", "Última atualização: " + new Date().toLocaleString());
  populateFilters(raw);

  const checkin = applyFilters(raw.checkin || []);
  const checkout = applyFilters(raw.checkout || []);
  const avaliacao = applyFilters(raw.avaliacao || []);

  const countsIn = countCategoriesForRows(checkin);
  const countsOut = countCategoriesForRows(checkout);

  // gráficos
  createChart("chart-checkin", "legend-checkin", countsIn);
  createChart("chart-checkout", "legend-checkout", countsOut);

  // NPS
  const nps = computeNPS(avaliacao, "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?");
  setText("metric-nps-rec", nps.nps === null ? "—" : nps.nps.toFixed(1));
  setText("nps-pct-detr", nps.pctDet.toFixed(1) + "%");
  setText("nps-pct-prom", nps.pctPro.toFixed(1) + "%");

  // Médias
  const avgAuto = average(avaliacao, "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?");
  const avgP1 = average(avaliacao, "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?");
  const avgP2 = average(avaliacao, "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?");

  setText("metric-nps-auto", avgAuto ? avgAuto.toFixed(2) : "—");
  setText("metric-nps-prof1", avgP1 ? avgP1.toFixed(2) : "—");
  setText("metric-nps-prof2", avgP2 ? avgP2.toFixed(2) : "—");

  // IA (não apagar, apenas preencher se nunca salvo)
  const saved = localStorage.getItem(AI_KEY);
  if (saved) $("insightBox").innerHTML = saved;
}

// =======================================================
// EVENTOS
// =======================================================
$("btn-refresh").addEventListener("click", () => renderAll());
$("btn-insights").addEventListener("click", () => fetchInsights());

// =======================================================
// AUTO REFRESH
// =======================================================
function startAutoRefresh() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(() => renderAll(), AUTO_REFRESH_MS);
}

window.addEventListener("load", () => {
  const saved = localStorage.getItem(AI_KEY);
  if (saved) $("insightBox").innerHTML = saved;

  renderAll();
  startAutoRefresh();
});
