// ===================== CONFIG =====================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec";
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

  // if select doesn't exist (older html) try other ids
  if (!selTurma && q("filter-turma")) {
    // older naming; populate both
    fillSelect(q("filter-turma"), turmas);
    fillSelect(q("filter-eixo"), eixos);
    fillSelect(q("filter-month"), months);
    return;
  }

  [selTurma, selEixo, selMonth].forEach(el => {
    if (!el) return;
    // keep first "Todos" option; if not present create it
    if (el.options.length === 0) el.add(new Option("Todos", "Todos"));
    while(el.options.length>1) el.remove(1);
  });

  turmas.forEach(t => { if(selTurma) selTurma.add(new Option(t,t)); });
  eixos.forEach(e => { if(selEixo) selEixo.add(new Option(e,e)); });
  months.forEach(m => { if(selMonth) selMonth.add(new Option(m,m)); });

  function fillSelect(selectEl, values) {
    selectEl.innerHTML = '';
    const first = document.createElement("option");
    first.value = "Todos";
    first.textContent = "Todos";
    selectEl.appendChild(first);
    values.forEach(v => {
      if (v) {
        const op = document.createElement("option");
        op.value = v;
        op.textContent = v;
        selectEl.appendChild(op);
      }
    });
  }
}

function applyFiltersToRows(rows) {
  // Accept either "Todos" or "" (empty) as all
  const turmaEl = q("sel-turma") || q("filter-turma");
  const eixoEl  = q("sel-eixo") || q("filter-eixo");
  const monthEl = q("sel-month")  || q("filter-month");

  const turma = turmaEl ? turmaEl.value : "Todos";
  const eixo  = eixoEl  ? eixoEl.value  : "Todos";
  const month = monthEl ? monthEl.value : "Todos";

  return (rows||[]).filter(r => {
    if (turma && turma !== "Todos" && (r["Turma"]||"") !== turma) return false;
    if (eixo  && eixo !== "Todos" && (r["Eixo"]||"") !== eixo) return false;
    if (month && month !== "Todos" && (r["Timestamp"]||"") !== month) return false;
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
  if (!container) return;
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
  if (!container) return;
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
    else if (!auto && (kn.includes("auto") || kn.includes("autoavalia") || kn.includes("auto-avalia"))) auto = k;
    else if (kn.includes("professor") || kn.includes("prof ")) {
      profs.push(k);
    }
  });
  // fallback: try specific phrasing if not found
  if (!rec) rec = keys.find(k => k.toLowerCase().includes("quanto você recomendaria"));
  return { recKey: rec, autoKey: auto, profKeys: profs };
}

// ---------------- NPS / Averages ----------------
function computeNPS(avRows, recKey) {
  if (!recKey) return { nps: null, promPct: 0, detrPct: 0, total: 0 };
  const numeric = avRows.map(r => Number(r[recKey])).filter(v => !isNaN(v));
  if (!numeric.length) return { nps: null, promPct: 0, detrPct: 0, total: 0 };
  const total = numeric.length;
  const prom = numeric.filter(v => v >= 9).length;
  const detr = numeric.filter(v => v <= 6).length;
  const nps = Math.round((prom/total*100) - (detr/total*100));
  return { nps, promPct: prom/total*100, detrPct: detr/total*100, total };
}

function averageNumeric(rows, key) {
  if (!key) return null;
  const nums = rows.map(r => Number(r[key])).filter(v => !isNaN(v));
  if (!nums.length) return null;
  return nums.reduce((a,b)=>a+b,0)/nums.length;
}

// ---------------- INSIGHTS RENDERING ----------------
function renderInsightsText(aiResponse) {
  const box = q("insights-container") || q("ai-summary") || null;
  if (!box) return;
  if (!aiResponse || !aiResponse.text) {
    box.textContent = "Nenhum insight disponível.";
    return;
  }
  // Keep simple formatting: double line breaks -> <br><br>, single line -> <br>
  const safe = escapeHtml(aiResponse.text);
  box.innerHTML = safe.replace(/\r\n/g, "\n").replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>");
}

// small helper to avoid HTML injection from AI (keeps emojis etc.)
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

  // calculate NPS and averages locally (more robust)
  const sample = state.raw.avaliacao && state.raw.avaliacao.length ? state.raw.avaliacao : [];
  const keys = findAvaliacaoKeys(sample);

  const npsObj = computeNPS(avaliacaoFiltered, keys.recKey);
  setText("metric-nps-rec", (npsObj.nps !== null) ? String(npsObj.nps) : "—");
  setText("nps-pct-prom", npsObj.promPct ? npsObj.promPct.toFixed(1) + "%" : "—");
  setText("nps-pct-detr", npsObj.detrPct ? npsObj.detrPct.toFixed(1) + "%" : "—");

  const autoAvg = keys.autoKey ? averageNumeric(avaliacaoFiltered, keys.autoKey) : null;
  setText("metric-nps-auto", autoAvg !== null ? Number(autoAvg).toFixed(2) : "—");

  const prof1Key = keys.profKeys && keys.profKeys.length ? keys.profKeys[0] : null;
  const prof2Key = keys.profKeys && keys.profKeys.length > 1 ? keys.profKeys[1] : null;
  const prof1Avg = prof1Key ? averageNumeric(avaliacaoFiltered, prof1Key) : null;
  const prof2Avg = prof2Key ? averageNumeric(avaliacaoFiltered, prof2Key) : null;
  setText("metric-nps-prof1", prof1Avg !== null ? Number(prof1Avg).toFixed(2) : "—");
  setText("metric-nps-prof2", prof2Avg !== null ? Number(prof2Avg).toFixed(2) : "—");

  // Also fetch AI insights but don't block UI
  // Build filter params
  const turmaEl = q("sel-turma") || q("filter-turma");
  const eixoEl  = q("sel-eixo") || q("filter-eixo");
  const monthEl = q("sel-month") || q("filter-month");
  const filters = {
    turma: turmaEl ? (turmaEl.value !== "Todos" ? turmaEl.value : null) : null,
    eixo:  eixoEl  ? (eixoEl.value  !== "Todos" ? eixoEl.value  : null) : null,
    month: monthEl ? (monthEl.value !== "Todos" ? monthEl.value : null) : null
  };

  // fetch AI summary (non-blocking)
  fetchInsights(filters).then(insResp => {
    if (insResp && insResp.ai) {
      // if the AI part is nested or different, handle gracefully
      const aiPart = insResp.ai.text ? insResp.ai : (insResp.ai || {});
      renderInsightsText(aiPart);
    } else {
      // fallback: set a simple summary using local calculations
      const fallbackText = generateFallbackInsightsText(npsObj, autoAvg, prof1Avg, prof2Avg, resultObj);
      renderInsightsText({ text: fallbackText });
    }
  }).catch(err => {
    console.warn("AI insights fetch failed:", err);
    const fallbackText = generateFallbackInsightsText(npsObj, autoAvg, prof1Avg, prof2Avg, resultObj);
    renderInsightsText({ text: fallbackText });
  });
}

// ---------------- EVENTS ----------------
q("btn-refresh") && q("btn-refresh").addEventListener("click", () => renderAll(true));
q("btn-insights") && q("btn-insights").addEventListener("click", async () => {
  // manual request to AI and show formatted result
  const turmaEl = q("sel-turma") || q("filter-turma");
  const eixoEl  = q("sel-eixo") || q("filter-eixo");
  const monthEl = q("sel-month") || q("filter-month");
  const filters = {
    turma: turmaEl ? (turmaEl.value !== "Todos" ? turmaEl.value : null) : null,
    eixo:  eixoEl  ? (eixoEl.value  !== "Todos" ? eixoEl.value  : null) : null,
    month: monthEl ? (monthEl.value !== "Todos" ? monthEl.value : null) : null
  };

  const resp = await fetchInsights(filters);
  if (!resp) return;
  if (resp.ai && resp.ai.text) {
    renderInsightsText(resp.ai);
  } else {
    // fallback
    renderInsightsText({ text: JSON.stringify(resp.ai || resp, null, 2) });
  }
});

// initial render + polling
renderAll(true);
setInterval(() => renderAll(true), AUTO_REFRESH_SECONDS * 1000);

// ----------------- Helpers: fallback insight generator -------------
function generateFallbackInsightsText(npsObj, autoAvg, prof1Avg, prof2Avg, resultObj) {
  // produce a short structured fallback text so UI never shows empty
  let lines = [];

  lines.push("Recomendação (NPS)");
  if (npsObj.nps !== null) {
    lines.push(`A turma tem NPS ${npsObj.nps}. Promotores: ${npsObj.promPct.toFixed(1)}%. Detratores: ${npsObj.detrPct.toFixed(1)}%`);
  } else {
    lines.push("Sem dados suficientes para calcular NPS.");
  }
  lines.push(""); // blank line

  lines.push("Autoavaliação (1–5)");
  lines.push(autoAvg !== null ? `Média: ${Number(autoAvg).toFixed(2)}` : "Sem dados");
  lines.push("");

  lines.push("Professor 1 (1–5)");
  lines.push(prof1Avg !== null ? `Média: ${Number(prof1Avg).toFixed(2)}` : "Sem dados");
  lines.push("");

  lines.push("Professor 2 (1–5)");
  lines.push(prof2Avg !== null ? `Média: ${Number(prof2Avg).toFixed(2)}` : "Sem dados");
  lines.push("");

  lines.push("Resultado final check-in e check-out");
  // summarize resultObj quickly: find top improvements and drops
  try {
    const diffs = [];
    Object.keys(resultObj).forEach(q => {
      const obj = resultObj[q];
      // consider "Ótimo" difference as indicator
      const val = obj["Ótimo"] || 0;
      diffs.push({ q, val });
    });
    diffs.sort((a,b)=> b.val - a.val);
    if (diffs.length) {
      lines.push(`Maior avanço em: ${diffs[0].q} (${diffs[0].val.toFixed(1)}%)`);
    }
  } catch(e) {
    // ignore
  }

  return lines.join("\n");
}
