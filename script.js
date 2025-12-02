// ===================== CONFIG =====================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec"; // <<-- substitua
const AUTO_REFRESH_SECONDS = 30; // polling interval
// ===================================================

let state = { raw: null, processed: null };

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

// Short labels -> perguntas completas (map)
const QUESTIONS = {
  "Autocontrole": "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Nomear emoções": "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
  "Autoconfiança": "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Relacionamento": "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
};

// mapping emoji categories order
const CATEGORIES = [
  { key: "Ruim", emoji: "😞" },
  { key: "Regular", emoji: "😬" },
  { key: "Bom", emoji: "🙂" },
  { key: "Ótimo", emoji: "😀" }
];

// helpers DOM
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

  [selTurma, selEixo, selMonth].forEach(el => {
    while(el.options.length>1) el.remove(1);
  });

  turmas.forEach(t => selTurma.add(new Option(t,t)));
  eixos.forEach(e => selEixo.add(new Option(e,e)));
  months.forEach(m => selMonth.add(new Option(m,m)));
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

// count & percent helpers
function countCategory(rows, questionFull, categoryEmoji) {
  let cnt = 0;
  (rows||[]).forEach(r => {
    const v = (r[questionFull] || "").toString();
    if (!v) return;
    if (v.indexOf(categoryEmoji) !== -1) cnt++;
  });
  return cnt;
}

function buildTableCounts(rows, title) {
  // rows: filtered rows for the sheet (checkin or checkout)
  // returns an object with counts & percents per short-question
  const out = {};
  const totalRows = rows.length || 0;

  Object.keys(QUESTIONS).forEach(short => {
    const full = QUESTIONS[short];
    const counts = {};
    CATEGORIES.forEach(cat => {
      counts[cat.key] = countCategory(rows, full, cat.emoji);
    });
    // percentages
    const perc = {};
    CATEGORIES.forEach(cat => {
      perc[cat.key] = totalRows ? (counts[cat.key] / totalRows * 100) : 0;
    });
    out[short] = { counts, perc, total: totalRows };
  });

  return out;
}

function formatPct(v) {
  return (Math.round(v * 100) / 100).toFixed(1) + "%";
}

function renderCountsTable(containerId, tableObj) {
  // tableObj: result of buildTableCounts
  // build HTML table matching excel layout
  const container = q(containerId);
  container.innerHTML = "";

  const table = document.createElement("table");
  table.className = "compare";

  // header row
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  const headers = ["Pergunta",
    "Qtd Ruim","% Ruim",
    "Qtd Bom","% Bom",
    "Qtd Regular","% Regular",
    "Qtd Ótimo","% Ótimo"];
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  Object.keys(tableObj).forEach(short => {
    const d = tableObj[short];
    const tr = document.createElement("tr");

    // Pergunta (left)
    const tdQ = document.createElement("td");
    tdQ.className = "table-left";
    tdQ.textContent = short;
    tr.appendChild(tdQ);

    // Qtd Ruim, % Ruim
    const tdQtdRuim = document.createElement("td"); tdQtdRuim.textContent = d.counts["Ruim"] || 0; tr.appendChild(tdQtdRuim);
    const tdPctRuim = document.createElement("td"); tdPctRuim.textContent = formatPct(d.perc["Ruim"] || 0); tr.appendChild(tdPctRuim);

    // Qtd Bom, % Bom
    const tdQtdBom = document.createElement("td"); tdQtdBom.textContent = d.counts["Bom"] || 0; tr.appendChild(tdQtdBom);
    const tdPctBom = document.createElement("td"); tdPctBom.textContent = formatPct(d.perc["Bom"] || 0); tr.appendChild(tdPctBom);

    // Qtd Regular, % Regular
    const tdQtdReg = document.createElement("td"); tdQtdReg.textContent = d.counts["Regular"] || 0; tr.appendChild(tdQtdReg);
    const tdPctReg = document.createElement("td"); tdPctReg.textContent = formatPct(d.perc["Regular"] || 0); tr.appendChild(tdPctReg);

    // Qtd Ótimo, % Ótimo
    const tdQtdOt = document.createElement("td"); tdQtdOt.textContent = d.counts["Ótimo"] || 0; tr.appendChild(tdQtdOt);
    const tdPctOt = document.createElement("td"); tdPctOt.textContent = formatPct(d.perc["Ótimo"] || 0); tr.appendChild(tdPctOt);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

function buildResultTable(checkinObj, checkoutObj) {
  // compute CO% - CI% for each question & category
  const out = {};
  Object.keys(QUESTIONS).forEach(short => {
    out[short] = {};
    CATEGORIES.forEach(cat => {
      const ci = (checkinObj[short] && checkinObj[short].perc[cat.key]) || 0;
      const co = (checkoutObj[short] && checkoutObj[short].perc[cat.key]) || 0;
      out[short][cat.key] = co - ci; // percentual difference
    });
  });
  return out;
}

function renderResultTable(containerId, resultObj) {
  const container = q(containerId);
  container.innerHTML = "";

  const table = document.createElement("table");
  table.className = "compare";

  // header
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  const headers = ["Pergunta", "% Ruim", "% Bom", "% Regular", "% Ótimo"];
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  Object.keys(resultObj).forEach(short => {
    const d = resultObj[short];
    const tr = document.createElement("tr");

    const tdQ = document.createElement("td"); tdQ.className="table-left"; tdQ.textContent = short; tr.appendChild(tdQ);

    // order: Ruim, Bom, Regular, Ótimo (to match excel layout expectation)
    const keysOrder = ["Ruim","Bom","Regular","Ótimo"];
    keysOrder.forEach(k => {
      const val = d[k] || 0;
      const td = document.createElement("td");
      const formatted = (Math.round(val * 100) / 100).toFixed(1) + "%";
      td.textContent = formatted;
      // color style
      if (val > 0) td.className = "result-positive";
      else if (val < 0) td.className = "result-negative";
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

// compute simple averages for KPI cards
function averageOfObjectValues(obj) {
  const vals = Object.values(obj || {}).map(o => o.perc ? (Object.values(o.perc).reduce((a,b)=>a+b,0)/4) : 0).filter(v => typeof v === "number");
  if (!vals.length) return 0;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}

// MAIN render
async function renderAll(ignoreCache=false) {
  const data = await fetchExec(ignoreCache);
  if (!data) return;
  state.raw = data.raw;
  state.processed = data.processed;

  setText("last-update", "Última: " + new Date().toLocaleString());

  populateFilters(data);

  // filtered rows
  const checkinFiltered = applyFiltersToRows(state.raw.checkin || []);
  const checkoutFiltered = applyFiltersToRows(state.raw.checkout || []);

  // build tables
  const checkinTableObj = buildTableCounts(checkinFiltered);
  const checkoutTableObj = buildTableCounts(checkoutFiltered);

  renderCountsTable("table-checkin", checkinTableObj);
  renderCountsTable("table-checkout", checkoutTableObj);

  const resultObj = buildResultTable(checkinTableObj, checkoutTableObj);
  renderResultTable("table-result", resultObj);

  // metrics
  const checkinAvgOverall = averageOfObjectValues(checkinTableObj);
  const checkoutAvgOverall = averageOfObjectValues(checkoutTableObj);
  setText("metric-checkin", checkinAvgOverall ? checkinAvgOverall.toFixed(2) : "—");
  setText("metric-checkout", checkoutAvgOverall ? checkoutAvgOverall.toFixed(2) : "—");

  // avaliacao recommendation avg (if present)
  const recKey = "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?";
  const recAvg = (state.processed.avaliacao && state.processed.avaliacao.perQuestion && state.processed.avaliacao.perQuestion[recKey] && state.processed.avaliacao.perQuestion[recKey].avg) || 0;
  setText("metric-avaliacao", recAvg ? Number(recAvg).toFixed(2) : "—");
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

// initial render + polling
renderAll(true);
setInterval(() => renderAll(true), AUTO_REFRESH_SECONDS * 1000);
