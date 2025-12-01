// =============================
// CONFIG
// =============================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec";
const AUTO_REFRESH_MS = 45000; // 45s
const STORAGE_LAST_JSON = "dashboard_last_json_v1";
const STORAGE_AI = "dashboard_ai_summary_v2";

// perguntas canônicas
const QUESTIONS = [
  "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
  "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];
const ABBR = ["Autocontrole","Nomear emoções","Autoconfiança","Relacionamento"];

// categorias e novas cores (solicitadas)
const CATEGORY_ORDER = ["😞","😬","🙂","😀"];
const CATEGORY_LABEL = {"😞":"Ruim","😬":"Regular","🙂":"Bom","😀":"Ótimo"};
const CATEGORY_COLOR = {
  "😞":"rgba(229,57,53,0.95)",    // vermelho
  "😬":"rgba(255,235,59,0.95)",   // amarelo
  "🙂":"rgba(33,150,243,0.95)",   // azul
  "😀":"rgba(76,175,80,0.95)"     // verde
};

let chartCheckin = null;
let chartCheckout = null;
let autoTimer = null;

// ------------- helpers DOM -------------
const $ = id => document.getElementById(id);
const setText = (id, txt) => { const el=$(id); if(el) el.textContent = txt; };
const setHTML = (id, html) => { const el=$(id); if(el) el.innerHTML = html; };

// diag
function diag(msg) {
  const el = $("diag-msg");
  if (el) el.textContent = msg;
  console.log("[diag]", msg);
}

// ------------- normalize & matching robust -------------
function normalizeText(s){ if(!s) return ""; return s.toString().toLowerCase().replace(/[“”]/g,'"').replace(/[’‘]/g,"'").replace(/[^a-z0-9\s"']/gi,' ').replace(/\s+/g,' ').trim(); }
const Q_TOKENS = [
  ["desestabiliz","autocontrol","autocontrole","desestabiliza"],
  ["nomear","emoc","de boa","deboa"],
  ["autoconfian","autoconfiança","autoconfiante","confian"],
  ["relacion","equipe","trabalhar em equipe","relacionamento"]
];

function findResponseForQuestion(row, qIndex) {
  const canonical = QUESTIONS[qIndex];
  if (row.hasOwnProperty(canonical)) return row[canonical];
  for (const key of Object.keys(row)) {
    const nk = normalizeText(key);
    for (const token of Q_TOKENS[qIndex]) {
      if (nk.includes(token)) return row[key];
    }
  }
  return null;
}

function extractEmoji(value) {
  if (!value) return null;
  const s = value.toString();
  for (const em of CATEGORY_ORDER) if (s.indexOf(em) >= 0) return em;
  return null;
}

// ------------- timestamp month helpers -------------
function extractMonth(r){
  const ts = r["Timestamp"] || r["Carimbo de data/hora"];
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0,7); // YYYY-MM
}

// ------------- fetch with caching + fallback -------------
async function tryFetchAndCache() {
  diag("Buscando dados do Apps Script...");
  try {
    const res = await fetch(APPSCRIPT_URL + "?_ts=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (!json || !json.raw) throw new Error("Resposta sem campo 'raw'");
    // cache last valid
    try { localStorage.setItem(STORAGE_LAST_JSON, JSON.stringify(json)); } catch(e){}
    diag("Dados carregados do Apps Script (remote).");
    return { source: "remote", json };
  } catch (e) {
    console.warn("fetch failed:", e);
    diag("Apps Script inacessível — tentando usar cache local...");
    // try cache
    const cached = localStorage.getItem(STORAGE_LAST_JSON);
    if (cached) {
      try {
        const json = JSON.parse(cached);
        diag("Dados carregados do cache local.");
        return { source: "cache", json };
      } catch(err) {
        console.warn("cache parse fail", err);
      }
    }
    // fallback to SAMPLE_JSON if present
    if (window.SAMPLE_JSON) {
      diag("Usando SAMPLE_JSON (fallback embutido).");
      return { source: "sample", json: window.SAMPLE_JSON };
    }
    diag("Nenhum dado disponível (remote/cache/sample).");
    return { source: "none", json: null };
  }
}

// ------------- populate filters -------------
function populateFilters(raw) {
  const combine = (raw.checkin || []).concat(raw.checkout || []).concat(raw.avaliacao || []);
  const turmas = Array.from(new Set(combine.map(r => r["Turma"]).filter(Boolean))).sort();
  const eixos  = Array.from(new Set(combine.map(r => r["Eixo"]).filter(Boolean))).sort();
  const months = Array.from(new Set(combine.map(extractMonth).filter(Boolean))).sort();

  const selT = $("sel-turma"), selE = $("sel-eixo"), selM = $("sel-month");
  [selT, selE, selM].forEach(s => { while (s.options.length > 1) s.remove(1); });

  turmas.forEach(t => selT.add(new Option(t, t)));
  eixos.forEach(e => selE.add(new Option(e, e)));
  months.forEach(m => selM.add(new Option(m, m)));

  diag(`Filtros atualizados — Turmas:${turmas.length} Eixos:${eixos.length} Meses:${months.length}`);
}

// ------------- apply filters -------------
function applyFilters(rows) {
  if (!rows) return [];
  const selT = $("sel-turma").value;
  const selE = $("sel-eixo").value;
  const selM = $("sel-month").value;

  return rows.filter(r => {
    if (selT !== "Todos" && (r["Turma"] || "") !== selT) return false;
    if (selE !== "Todos" && (r["Eixo"] || "") !== selE) return false;
    const mon = extractMonth(r);
    if (selM !== "Todos" && mon !== selM) return false;
    return true;
  });
}

// ------------- aggregation counts -------------
function countCategoriesForRows(rows) {
  const out = QUESTIONS.map(()=> { const o={}; CATEGORY_ORDER.forEach(e=>o[e]=0); return o; });
  rows.forEach(r => {
    QUESTIONS.forEach((q, qi) => {
      const val = findResponseForQuestion(r, qi);
      const em = extractEmoji(val);
      if (em && out[qi] && out[qi][em] !== undefined) out[qi][em]++;
    });
  });
  return out;
}

// ------------- charts -------------
const barValuePlugin = {
  id:'barValuePlugin',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((ds, dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      if (!meta || !meta.data) return;
      meta.data.forEach((bar, idx) => {
        const val = ds.data[idx];
        if (!val && val !== 0) return;
        ctx.save();
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // draw number slightly above bar top for visibility
        const x = bar.x;
        const y = bar.y - 8;
        ctx.fillStyle = "#000";
        ctx.fillText(val.toString(), x, y);
        ctx.restore();
      });
    });
  }
};

function renderLegend(targetId) {
  const el = $(targetId);
  if (!el) return;
  el.innerHTML = "";
  CATEGORY_ORDER.forEach(em => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = CATEGORY_COLOR[em];
    item.appendChild(sw);
    item.appendChild(document.createTextNode(`${em} ${CATEGORY_LABEL[em]}`));
    el.appendChild(item);
  });
}

function createChart(canvasId, legendId, countsArray) {
  const labels = ABBR.slice();
  // datasets: one per category (so bars grouped by question)
  const datasets = CATEGORY_ORDER.map(em => ({
    label: CATEGORY_LABEL[em],
    data: countsArray.map(qObj => qObj[em] || 0),
    backgroundColor: CATEGORY_COLOR[em]
  }));

  const ctx = $(canvasId).getContext('2d');
  if (canvasId === "chart-checkin" && chartCheckin) chartCheckin.destroy();
  if (canvasId === "chart-checkout" && chartCheckout) chartCheckout.destroy();

  const cfg = {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode:'index', intersect:false },
      plugins: { legend: { display: false } },
      scales: {
        x: { stacked: false },
        y: { beginAtZero: true, ticks: { precision:0 } }
      }
    },
    plugins: [barValuePlugin]
  };

  const ch = new Chart(ctx, cfg);
  if (canvasId === "chart-checkin") chartCheckin = ch;
  if (canvasId === "chart-checkout") chartCheckout = ch;

  renderLegend(legendId);
}

// ------------- NPS & averages -------------
function asNumber(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  const n = Number(v.toString().trim().replace(',','.'));
  return isNaN(n) ? NaN : n;
}

function computeNPS(rows, key) {
  const vals = (rows||[]).map(r => asNumber(r[key])).filter(n => !isNaN(n));
  const total = vals.length;
  if (!total) return { nps:null, pctDet:0, pctPro:0, total:0 };
  const detr = vals.filter(v => v >=0 && v <=6).length;
  const prom = vals.filter(v => v >=9 && v <=10).length;
  const pctDet = (detr/total)*100;
  const pctPro = (prom/total)*100;
  const nps = pctPro - pctDet;
  return { nps, pctDet, pctPro, total, detr, prom };
}

function average(rows, key) {
  const vals = (rows||[]).map(r => asNumber(r[key])).filter(n => !isNaN(n));
  if (!vals.length) return null;
  const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
  return avg;
}

// ------------- comparison table -------------
function buildComparisonTable(countsIn, countsOut) {
  // counts arrays indexed by question; each has category counts
  const rows = QUESTIONS.map((q, i) => {
    const inCounts = countsIn[i];
    const outCounts = countsOut[i];
    const totalIn = Object.values(inCounts).reduce((a,b)=>a+b,0) || 0;
    const totalOut = Object.values(outCounts).reduce((a,b)=>a+b,0) || 0;
    const cols = {};
    CATEGORY_ORDER.forEach(em => {
      const inPct = totalIn ? (inCounts[em] / totalIn * 100) : 0;
      const outPct = totalOut ? (outCounts[em] / totalOut * 100) : 0;
      const delta = +(outPct - inPct); // can be negative
      cols[em] = { inPct, outPct, delta };
    });
    return { question: ABBR[i], cols, totalIn, totalOut };
  });

  // build HTML table: columns per category (CI%, CO%, Δ)
  let html = `<div class="table-wrap"><table class="table-compare"><thead><tr><th>Pergunta</th>`;
  CATEGORY_ORDER.forEach(em => {
    html += `<th>${CATEGORY_LABEL[em]} (CI %)</th><th>${CATEGORY_LABEL[em]} (CO %)</th><th>Δ</th>`;
  });
  html += `</tr></thead><tbody>`;
  rows.forEach(r => {
    html += `<tr><td style="text-align:left;padding-left:10px">${escapeHtml(r.question)}</td>`;
    CATEGORY_ORDER.forEach(em => {
      const c = r.cols[em];
      html += `<td>${c.inPct.toFixed(1)}%</td><td>${c.outPct.toFixed(1)}%</td>`;
      const cls = c.delta >= 0 ? "delta-up" : "delta-down";
      const sign = c.delta >= 0 ? "+" : "";
      html += `<td class="${cls}">${sign}${c.delta.toFixed(1)}%</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table></div>`;
  return html;
}

// escape
function escapeHtml(s){ return s?.toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || ""; }

// ------------- AI formatting final (categorias solicitadas) -------------
function formatAISummary(rawText, avaliacaoRows, countsIn, countsOut) {
  // produce six categories:
  // 1) Análise NPS
  // 2) Análise Autoavaliação
  // 3) Avaliação professor 1
  // 4) Avaliação professor 2
  // 5) Evolução percentual (checkin->checkout) por pergunta e categoria
  // 6) Optional short friendly commentary (use rawText if available)

  // safe raw
  const raw = (rawText || "").toString().replace(/\r/g,'').trim();

  // NPS
  const npsObj = computeNPS(avaliacaoRows, "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?");
  const npsLine = npsObj.nps === null ? "Sem dados" : `${npsObj.nps.toFixed(1)} (Promotores ${npsObj.pctPro.toFixed(1)}% — Detratores ${npsObj.pctDet.toFixed(1)}%)`;

  // Autoavaliação
  const avgAuto = average(avaliacaoRows, "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?");
  const avgAutoLine = avgAuto === null ? "Sem dados" : `${avgAuto.toFixed(2)} (média)`;

  // Professores
  const avgP1 = average(avaliacaoRows, "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?");
  const avgP2 = average(avaliacaoRows, "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?");
  const prof1Line = avgP1 === null ? "Sem dados" : `${avgP1.toFixed(2)} — ${toneFromAverage(avgP1)}`;
  const prof2Line = avgP2 === null ? "Sem dados" : `${avgP2.toFixed(2)} — ${toneFromAverage(avgP2)}`;

  // Evolução percentual
  const evolution = QUESTIONS.map((q, i) => {
    const inCounts = countsIn[i];
    const outCounts = countsOut[i];
    const totalIn = Object.values(inCounts).reduce((a,b)=>a+b,0) || 0;
    const totalOut = Object.values(outCounts).reduce((a,b)=>a+b,0) || 0;
    const cats = CATEGORY_ORDER.map(em => {
      const inPct = totalIn ? (inCounts[em]/totalIn*100) : 0;
      const outPct = totalOut ? (outCounts[em]/totalOut*100) : 0;
      const delta = outPct - inPct;
      return { em, inPct, outPct, delta };
    });
    return { question: ABBR[i], cats };
  });

  // assemble HTML - informal tone, short lines, emojis, newlines per insight
  const parts = [];
  parts.push(`<p><strong>1) Análise NPS</strong></p><p>🔢 NPS: ${escapeHtml(npsLine)}</p>`);
  parts.push(`<p><strong>2) Análise Autoavaliação</strong></p><p>📝 Autoavaliação média: ${escapeHtml(avgAutoLine)}</p>`);
  parts.push(`<p><strong>3) Avaliação professor 1</strong></p><p>👩‍🏫 ${escapeHtml(prof1Line)}</p>`);
  parts.push(`<p><strong>4) Avaliação professor 2</strong></p><p>👨‍🏫 ${escapeHtml(prof2Line)}</p>`);

  // evolution - concise lines
  parts.push(`<p><strong>5) Evolução (check-in → check-out) por pergunta</strong></p>`);
  evolution.forEach(ev => {
    const lines = ev.cats.map(c => {
      const sign = c.delta >= 0 ? "+" : "";
      return `${c.em} ${CATEGORY_LABEL[c.em]}: ${c.inPct.toFixed(1)}% → ${c.outPct.toFixed(1)}% (Δ ${sign}${c.delta.toFixed(1)}%)`;
    }).join("<br/>");
    parts.push(`<p><strong>${escapeHtml(ev.question)}</strong><br/>${lines}</p>`);
  });

  // 6) Use rawText (if provided) as short 'insight note' but keep simple & informal
  if (raw) {
    parts.push(`<p><strong>6) Observações gerais</strong></p>`);
    // trim to short sentences (split by punctuation)
    const sents = raw.split(/[\n]+/).map(l => l.trim()).filter(Boolean);
    sents.slice(0,8).forEach(line => {
      // ensure short line for readability
      const short = line.length > 200 ? line.slice(0,200) + "..." : line;
      parts.push(`<p>💬 ${escapeHtml(short)}</p>`);
    });
  }

  // join with small separators
  const html = parts.join("");
  return html;
}

// helper tone
function toneFromAverage(avg) {
  if (avg >= 4.5) return "Top! 🎉";
  if (avg >= 3.5) return "Bom 👍";
  if (avg >= 2.5) return "Ok";
  return "Precisa melhorar";
}

// ------------- insights call -------------
async function fetchInsights() {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: Date.now() });
    const t = $("sel-turma").value; if (t !== "Todos") params.set("turma", t);
    const e = $("sel-eixo").value; if (e !== "Todos") params.set("eixo", e);
    const m = $("sel-month").value; if (m !== "Todos") params.set("month", m);

    const res = await fetch(APPSCRIPT_URL + "?" + params.toString());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();

    // raw AI text if backend returns it
    const rawAi = json.ai?.resumo || json.ai?.text || json.text || "";
    // compute current counts to include evolution; we will use filtered rows from last fetch (or cache)
    const last = getLastJson();
    const rawData = last?.raw || (window.SAMPLE_JSON || {}).raw || { checkin:[], checkout:[], avaliacao:[] };
    const checkin = applyFilters(rawData.checkin || []);
    const checkout = applyFilters(rawData.checkout || []);
    const avaliacao = applyFilters(rawData.avaliacao || []);

    const countsIn = countCategoriesForRows(checkin);
    const countsOut = countCategoriesForRows(checkout);

    const formatted = formatAISummary(rawAi || "", avaliacao, countsIn, countsOut);
    localStorage.setItem(STORAGE_AI, formatted);
    $("insightBox").innerHTML = formatted;
    diag("Insight IA gerado e salvo localmente.");
  } catch (err) {
    console.error("fetchInsights error", err);
    diag("Erro ao gerar insight (ver console).");
    alert("Erro ao gerar insight — veja console.");
  }
}

// ------------- render flow -------------
function getLastJson() {
  try {
    const cached = localStorage.getItem(STORAGE_LAST_JSON);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch(e) { return null; }
}

async function renderAll() {
  const res = await tryFetchAndCache();
  if (!res || !res.json) {
    diag("Sem dados para renderizar.");
    return;
  }
  const json = res.json;
  const raw = json.raw || json;

  setText("last-update", "Última: " + new Date().toLocaleString());
  populateFilters(raw);

  const checkinRows = applyFilters(raw.checkin || []);
  const checkoutRows = applyFilters(raw.checkout || []);
  const avaliacaoRows = applyFilters(raw.avaliacao || []);

  const countsIn = countCategoriesForRows(checkinRows);
  const countsOut = countCategoriesForRows(checkoutRows);

  createChart("chart-checkin", "legend-checkin", countsIn);
  createChart("chart-checkout", "legend-checkout", countsOut);

  // comparison table
  const tableHtml = buildComparisonTable(countsIn, countsOut);
  setHTML("comparison-table", tableHtml);

  // NPS
  const nps = computeNPS(avaliacaoRows, "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?");
  setText("metric-nps-rec", nps.nps === null ? "—" : nps.nps.toFixed(1));
  setText("nps-pct-detr", nps.pctDet !== undefined ? nps.pctDet.toFixed(1) + "%" : "—");
  setText("nps-pct-prom", nps.pctPro !== undefined ? nps.pctPro.toFixed(1) + "%" : "—");

  // averages
  const avgAuto = average(avaliacaoRows, "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?");
  const avgP1 = average(avaliacaoRows, "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?");
  const avgP2 = average(avaliacaoRows, "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?");
  setText("metric-nps-auto", avgAuto === null ? "—" : avgAuto.toFixed(2));
  setText("metric-nps-prof1", avgP1 === null ? "—" : avgP1.toFixed(2));
  setText("metric-nps-prof2", avgP2 === null ? "—" : avgP2.toFixed(2));

  // AI summary persistence: keep saved unless user clicked insights
  const savedAI = localStorage.getItem(STORAGE_AI);
  if (savedAI && savedAI.length) {
    $("insightBox").innerHTML = savedAI;
  } else if (json.ai || json.text) {
    const rawAi = json.ai?.resumo || json.ai?.text || json.text || "";
    const formatted = formatAISummary(rawAi, avaliacaoRows, countsIn, countsOut);
    localStorage.setItem(STORAGE_AI, formatted);
    $("insightBox").innerHTML = formatted;
  } else {
    if (!savedAI) $("insightBox").innerHTML = "Clique em 'Gerar Insights IA' para obter o resumo.";
  }
}

// ------------- events & auto refresh -------------
$("btn-refresh").addEventListener("click", () => renderAll());
$("btn-insights").addEventListener("click", () => fetchInsights());
$("diag-show-json").addEventListener("click", () => {
  const last = getLastJson() || window.SAMPLE_JSON || {};
  const w = window.open("", "_blank");
  w.document.write(`<pre style="white-space:pre-wrap;">${escapeHtml(JSON.stringify(last, null, 2))}</pre>`);
  w.document.close();
});
["sel-turma","sel-eixo","sel-month"].forEach(id => {
  $(id).addEventListener("change", () => { /* manual refresh only */ });
});

function startAutoRefresh() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(() => renderAll(), AUTO_REFRESH_MS);
}

window.addEventListener("load", () => {
  // restore AI if exists
  const saved = localStorage.getItem(STORAGE_AI);
  if (saved) $("insightBox").innerHTML = saved;
  renderAll();
  startAutoRefresh();
});
