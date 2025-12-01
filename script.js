// ===================== CONFIG =====================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec"; // <<--- substitua aqui
const AUTO_REFRESH_SECONDS = 30; // polling interval
// ===================================================

let state = { raw: null, processed: null, charts: {} };

async function fetchExec(ignoreCache = false) {
  try {
    const params = new URLSearchParams();
    if (ignoreCache) params.set("_ts", String(Date.now()));
    const url = APPSCRIPT_URL + (params.toString() ? "?" + params.toString() : "");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error("fetchExec error:", err);
    alert("Erro ao buscar dados: " + err.message);
    return null;
  }
}

async function fetchInsights(filters = {}) {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: String(Date.now()) });
    if (filters.turma) params.set("turma", filters.turma);
    if (filters.eixo)  params.set("eixo", filters.eixo);
    if (filters.month) params.set("month", filters.month);
    const url = APPSCRIPT_URL + "?" + params.toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error("fetchInsights error:", err);
    alert("Erro ao gerar insights: " + err.message);
    return null;
  }
}

// UTIL helpers
function q(id){ return document.getElementById(id); }
function setText(id, txt){ const el = q(id); if (el) el.textContent = txt; }

function populateFilters(data) {
  const checkin = data.raw.checkin || [];
  const checkout = data.raw.checkout || [];
  const merged = checkin.concat(checkout);

  const turmas = Array.from(new Set(merged.map(r => r["Turma"]).filter(Boolean))).sort();
  const eixos  = Array.from(new Set(merged.map(r => r["Eixo"]).filter(Boolean))).sort();
  const months = Array.from(new Set(merged.map(r => r["Timestamp"]).filter(Boolean))).sort();

  const selTurma = q("sel-turma");
  const selEixo  = q("sel-eixo");
  const selMonth = q("sel-month");

  // clear, then add
  [selTurma, selEixo, selMonth].forEach(el => {
    while(el.options.length>1) el.remove(1);
  });

  turmas.forEach(t => selTurma.add(new Option(t,t)));
  eixos.forEach(e => selEixo.add(new Option(e,e)));
  months.forEach(m => selMonth.add(new Option(m,m)));
}

function countResponses(rows, col) {
  const map = {};
  (rows||[]).forEach(r => {
    const v = (r[col] || "").toString();
    map[v] = (map[v] || 0) + 1;
  });
  return Object.entries(map).map(([k,v]) => ({ label:k, value:v }));
}

function buildPie(chartId, dataArr, title) {
  const ctx = q(chartId).getContext("2d");
  if (state.charts[chartId]) { state.charts[chartId].destroy(); }
  const labels = dataArr.map(d=>d.label);
  const values = dataArr.map(d=>d.value);
  state.charts[chartId] = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data: values, backgroundColor: generateColors(values.length) }]},
    options: { responsive:true, plugins: { legend: { position: 'bottom' }, title: { display: false, text: title } } }
  });
}

function buildBarCompare(chartId, questions, checkinAvgs, checkoutAvgs) {
  const ctx = q(chartId).getContext("2d");
  if (state.charts[chartId]) { state.charts[chartId].destroy(); }
  const labels = questions;
  state.charts[chartId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Check-in', data: checkinAvgs, backgroundColor: 'rgba(101,38,109,0.8)' },
        { label: 'Check-out', data: checkoutAvgs, backgroundColor: 'rgba(255,131,79,0.8)' }
      ]
    },
    options: { responsive:true, scales:{ y:{ beginAtZero:true } } }
  });
}

function generateColors(n){
  const palette = ['#65266D','#FF834F','#4CAF50','#2196F3','#FFC107','#9C27B0','#00BCD4'];
  const out = [];
  for(let i=0;i<n;i++) out.push(palette[i % palette.length]);
  return out;
}

function applyFiltersToRows(rows) {
  const turma = q("sel-turma").value;
  const eixo  = q("sel-eixo").value;
  const month = q("sel-month").value;
  return (rows||[]).filter(r => {
    if (turma !== "Todos" && (r["Turma"]||"") !== turma) return false;
    if (eixo  !== "Todos" && (r["Eixo"]||"") !== eixo) return false;
    if (month !== "Todos" && (r["Timestamp"]||"") !== month) return false;
    return true;
  });
}

function computeAvgFromProcessed(proc, question) {
  if (!proc || !proc.perQuestion) return 0;
  const q = proc.perQuestion[question];
  return q && q.avg_score ? Number(q.avg_score) : 0;
}

// MAIN render
async function renderAll(ignoreCache=false) {
  const data = await fetchExec(ignoreCache);
  if (!data) return;
  state.raw = data.raw;
  state.processed = data.processed;

  // update last update text
  setText("last-update", "Última: " + new Date().toLocaleString());

  populateFilters(data);

  // compute and show metrics (basic examples)
  const checkinAvgOverall = averageOfObjectValues(state.processed.checkin.perQuestion || {});
  const checkoutAvgOverall = averageOfObjectValues(state.processed.checkout.perQuestion || {});
  setText("metric-checkin", checkinAvgOverall ? checkinAvgOverall.toFixed(2) : "—");
  setText("metric-checkout", checkoutAvgOverall ? checkoutAvgOverall.toFixed(2) : "—");
  const recKey = "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?";
  const recAvg = (state.processed.avaliacao && state.processed.avaliacao.perQuestion && state.processed.avaliacao.perQuestion[recKey] && state.processed.avaliacao.perQuestion[recKey].avg) || 0;
  setText("metric-avaliacao", recAvg ? Number(recAvg).toFixed(2) : "—");

  // prepare chart data for Q1 and Q2 as example
  const q1 = "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?";
  const q2 = "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?";

  const checkinFiltered = applyFiltersToRows(state.raw.checkin);
  const checkoutFiltered = applyFiltersToRows(state.raw.checkout);

  const ch1 = countResponses(checkinFiltered, q1);
  const co1 = countResponses(checkoutFiltered, q1);
  buildPie("chart-checkin-q1", ch1, "Checkin Q1");
  buildPie("chart-checkout-q1", co1, "Checkout Q1");

  const ch2 = countResponses(checkinFiltered, q2);
  const co2 = countResponses(checkoutFiltered, q2);
  buildPie("chart-checkin-q2", ch2, "Checkin Q2");
  buildPie("chart-checkout-q2", co2, "Checkout Q2");

  // comparison chart compute arrays for 4 questions
  const questions = [
    "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
    "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
    "Você consegue reconhecer características de um comportamento autoconfiante?",
    "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
  ];
  const checkinAvgs = questions.map(qs => computeAvgFromProcessed(state.processed.checkin, qs));
  const checkoutAvgs = questions.map(qs => computeAvgFromProcessed(state.processed.checkout, qs));
  buildBarCompare("chart-compare", questions.map(s => shortLabel(s)), checkinAvgs, checkoutAvgs);
}

function averageOfObjectValues(obj) {
  const vals = Object.values(obj || {}).map(o => o.avg_score || o.avg || 0).filter(v => typeof v === "number");
  if (!vals.length) return 0;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}

function shortLabel(s) {
  if (s.length > 36) return s.slice(0,33)+"...";
  return s;
}

// EVENTS
q("btn-refresh").addEventListener("click", () => renderAll(true));
q("btn-insights").addEventListener("click", async () => {
  const filters = {
    turma: q("sel-turma").value !== "Todos" ? q("sel-turma").value : null,
    eixo: q("sel-eixo").value !== "Todos" ? q("sel-eixo").value : null,
    month: q("sel-month").value !== "Todos" ? q("sel-month").value : null
  };
  const resp = await fetchInsights(filters);
  if (!resp) return;
  const aiText = (resp.ai && resp.ai.text) ? resp.ai.text : JSON.stringify(resp.ai || resp, null, 2);
  q("ai-summary").textContent = aiText;
});

// auto-refresh polling
renderAll(true);
setInterval(() => renderAll(true), AUTO_REFRESH_SECONDS * 1000);
