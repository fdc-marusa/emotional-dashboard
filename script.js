// ===================== CONFIG =====================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec"; // <<-- substitua pela sua URL /exec
const AUTO_REFRESH_SECONDS = 30; // polling interval
// ===================================================

let state = { raw: null, processed: null };

// --------------- Fetch / Helpers ---------------
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

function q(id){ return document.getElementById(id); }
function setText(id, txt){ const el = q(id); if (el) el.textContent = txt; }

// ---------------- Questions & Categories ----------------
const QUESTIONS = {
  "Autocontrole": "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Nomear emoções": "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
  "Autoconfiança": "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Relacionamento": "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
};

const CATEGORIES = [
  { key: "Ruim", emoji: "😞" },
  { key: "Regular", emoji: "😬" },
  { key: "Bom", emoji: "🙂" },
  { key: "Ótimo", emoji: "😀" }
];

// ---------------- Filters ----------------
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

// ---------------- Count / Percent helpers ----------------
function countCategory(rows, questionFull, categoryEmoji) {
  let cnt = 0;
  (rows||[]).forEach(r => {
    const v = (r[questionFull] || "").toString();
    if (!v) return;
    if (v.indexOf(categoryEmoji) !== -1) cnt++;
  });
  return cnt;
}

function buildTableCounts(rows) {
  const out = {};
  const totalRows = rows.length || 0;
  Object.keys(QUESTIONS).forEach(short => {
    const full = QUESTIONS[short];
    const counts = {};
    CATEGORIES.forEach(cat => {
      counts[cat.key] = countCategory(rows, full, cat.emoji);
    });
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

// ---------------- Render Tables ----------------
function renderCountsTable(containerId, tableObj) {
  const container = q(containerId);
  container.innerHTML = "";
  const table = document.createElement("table");
  table.className = "compare";

  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  const headers = ["Pergunta",
    "Qtd Ruim","% Ruim",
    "Qtd Bom","% Bom",
    "Qtd Regular","% Regular",
    "Qtd Ótimo","% Ótimo"];
  headers.forEach(h => { const th = document.createElement("th"); th.textContent = h; hrow.appendChild(th); });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  Object.keys(tableObj).forEach(short => {
    const d = tableObj[short];
    const tr = document.createElement("tr");

    const tdQ = document.createElement("td"); tdQ.className = "table-left"; tdQ.textContent = short; tr.appendChild(tdQ);

    const tdQtdRuim = document.createElement("td"); tdQtdRuim.textContent = d.counts["Ruim"] || 0; tr.appendChild(tdQtdRuim);
    const tdPctRuim = document.createElement("td"); tdPctRuim.textContent = formatPct(d.perc["Ruim"] || 0); tr.appendChild(tdPctRuim);

    const tdQtdBom = document.createElement("td"); tdQtdBom.textContent = d.counts["Bom"] || 0; tr.appendChild(tdQtdBom);
    const tdPctBom = document.createElement("td"); tdPctBom.textContent = formatPct(d.perc["Bom"] || 0); tr.appendChild(tdPctBom);

    const tdQtdReg = document.createElement("td"); tdQtdReg.textContent = d.counts["Regular"] || 0; tr.appendChild(tdQtdReg);
    const tdPctReg = document.createElement("td"); tdPctReg.textContent = formatPct(d.perc["Regular"] || 0); tr.appendChild(tdPctReg);

    const tdQtdOt = document.createElement("td"); tdQtdOt.textContent = d.counts["Ótimo"] || 0; tr.appendChild(tdQtdOt);
    const tdPctOt = document.createElement("td"); tdPctOt.textContent = formatPct(d.perc["Ótimo"] || 0); tr.appendChild(tdPctOt);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

function buildResultTable(checkinObj, checkoutObj) {
  const out = {};
  Object.keys(QUESTIONS).forEach(short => {
    out[short] = {};
    CATEGORIES.forEach(cat => {
      const ci = (checkinObj[short] && checkinObj[short].perc[cat.key]) || 0;
      const co = (checkoutObj[short] && checkoutObj[short].perc[cat.key]) || 0;
      out[short][cat.key] = co - ci;
    });
  });
  return out;
}

function renderResultTable(containerId, resultObj) {
  const container = q(containerId);
  container.innerHTML = "";
  const table = document.createElement("table");
  table.className = "compare";

  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  const headers = ["Pergunta", "% Ruim", "% Bom", "% Regular", "% Ótimo"];
  headers.forEach(h => { const th = document.createElement("th"); th.textContent = h; hrow.appendChild(th); });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  Object.keys(resultObj).forEach(short => {
    const d = resultObj[short];
    const tr = document.createElement("tr");
    const tdQ = document.createElement("td"); tdQ.className="table-left"; tdQ.textContent = short; tr.appendChild(tdQ);

    const keysOrder = ["Ruim","Bom","Regular","Ótimo"];
    keysOrder.forEach(k => {
      const val = d[k] || 0;
      const td = document.createElement("td");
      const formatted = (Math.round(val * 100) / 100).toFixed(1) + "%";
      td.textContent = formatted;
      if (val > 0) td.className = "result-positive";
      else if (val < 0) td.className = "result-negative";
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

// ---------------- Evaluation keys discovery ----------------
function findAvaliacaoKeys(sampleRows) {
  const keys = sampleRows && sampleRows.length ? Object.keys(sampleRows[0]) : [];
  let rec = null, auto = null, profs = [];
  keys.forEach(k => {
    const kn = k.toString().toLowerCase();
    if (!rec && kn.includes("recomend")) rec = k;
    else if (!auto && (kn.includes("auto") || kn.includes("autoavalia"))) auto = k;
    else if (kn.includes("professor") || kn.includes("prof")) {
      profs.push(k);
    }
  });
  return { recKey: rec, autoKey: auto, profKeys: profs };
}

// ---------------- NPS / Averages ----------------
function computeNPS(avRows, recKey) {
  const numeric = avRows.map(r => Number(r[recKey])).filter(v => !isNaN(v));
  if (!numeric.length) return { nps: null, prom: 0, detr: 0, total:0 };
  const total = numeric.length;
  const prom = numeric.filter(v => v >= 9).length;
  const detr = numeric.filter(v => v <= 6).length;
  const nps = Math.round((prom/total*100) - (detr/total*100));
  return { nps, promPct: prom/total*100, detrPct: detr/total*100, total };
}

function averageNumeric(rows, key) {
  const nums = rows.map(r => Number(r[key])).filter(v => !isNaN(v));
  if (!nums.length) return null;
  return nums.reduce((a,b)=>a+b,0)/nums.length;
}

// ---------------- MAIN render ----------------
async function renderAll(ignoreCache=false) {
  const data = await fetchExec(ignoreCache);
  if (!data) return;
  state.raw = data.raw || {};
  state.processed = data.processed || {};

  setText("last-update", "Última: " + new Date().toLocaleString());

  populateFilters(data);

  const checkinFiltered = applyFiltersToRows(state.raw.checkin || []);
  const checkoutFiltered = applyFiltersToRows(state.raw.checkout || []);
  const avaliacaoFiltered = applyFiltersToRows(state.raw.avaliacao || []);

  // tables
  const checkinTableObj = buildTableCounts(checkinFiltered);
  const checkoutTableObj = buildTableCounts(checkoutFiltered);
  renderCountsTable("table-checkin", checkinTableObj);
  renderCountsTable("table-checkout", checkoutTableObj);

  const resultObj = buildResultTable(checkinTableObj, checkoutTableObj);
  renderResultTable("table-result", resultObj);

  // metrics NPS & averages - discover keys
  const sample = state.raw.avaliacao && state.raw.avaliacao.length ? state.raw.avaliacao : [];
  const keys = findAvaliacaoKeys(sample);
  // compute NPS
  if (keys.recKey) {
    const npsObj = computeNPS(avaliacaoFiltered, keys.recKey);
    setText("metric-nps-rec", (npsObj.nps !== null) ? npsObj.nps + "" : "—");
    setText("nps-pct-prom", npsObj.promPct ? npsObj.promPct.toFixed(1) + "%" : "—");
    setText("nps-pct-detr", npsObj.detrPct ? npsObj.detrPct.toFixed(1) + "%" : "—");
  } else {
    setText("metric-nps-rec", "—");
    setText("nps-pct-prom", "—");
    setText("nps-pct-detr", "—");
  }

  // auto / prof averages
  const autoAvg = keys.autoKey ? averageNumeric(avaliacaoFiltered, keys.autoKey) : null;
  setText("metric-nps-auto", autoAvg !== null ? Number(autoAvg).toFixed(2) : "—");

  const prof1Key = keys.profKeys && keys.profKeys.length ? keys.profKeys[0] : null;
  const prof2Key = keys.profKeys && keys.profKeys.length > 1 ? keys.profKeys[1] : null;
  const prof1Avg = prof1Key ? averageNumeric(avaliacaoFiltered, prof1Key) : null;
  const prof2Avg = prof2Key ? averageNumeric(avaliacaoFiltered, prof2Key) : null;
  setText("metric-nps-prof1", prof1Avg !== null ? Number(prof1Avg).toFixed(2) : "—");
  setText("metric-nps-prof2", prof2Avg !== null ? Number(prof2Avg).toFixed(2) : "—");
}

// ---------------- EVENTS ----------------
q("btn-refresh").addEventListener("click", () => renderAll(true));
q("btn-insights").addEventListener("click", async () => {
  const filters = {
    turma: q("sel-turma").value !== "Todos" ? q("sel-turma").value : null,
    eixo: q("sel-eixo").value !== "Todos" ? q("sel-eixo").value : null,
    month: q("sel-month").value !== "Todos" ? q("sel-month").value : null
  };
  const resp = await fetchInsights(filters);
  if (!resp) return;
  // Expect resp.ai.text to be a multi-section short summary
  const aiTextRaw = (resp.ai && resp.ai.text) ? resp.ai.text : null;
  if (aiTextRaw) {
    // ensure header sections in correct order; if AI returned full text, use as-is
    q("ai-summary").textContent = aiTextRaw;
  } else {
    q("ai-summary").textContent = JSON.stringify(resp.ai || resp, null, 2);
  }
});

// initial render + polling
renderAll(true);
setInterval(() => renderAll(true), AUTO_REFRESH_SECONDS * 1000);
