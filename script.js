// =============================
// CONFIG
// =============================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec";
const AUTO_REFRESH_MS = 45000; // 45s

// perguntas canônicas
const QUESTIONS = [
  "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
  "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];
const ABBR = ["Autocontrole","Nomear emoções","Autoconfiança","Relacionamento"];

// categorias
const CATEGORY_ORDER = ["😞","😬","🙂","😀"];
const CATEGORY_LABEL = {"😞":"Ruim","😬":"Regular","🙂":"Bom","😀":"Ótimo"};
const CATEGORY_COLOR = {"😞":"rgba(220,53,69,0.9)","😬":"rgba(255,159,64,0.9)","🙂":"rgba(255,205,86,0.9)","😀":"rgba(75,192,192,0.9)"};

// storage key IA
const AI_KEY = "dashboard_ai_summary_v2";

let chartCheckin = null;
let chartCheckout = null;
let autoTimer = null;

// DOM helpers
const $ = id => document.getElementById(id);
const setText = (id,txt) => { const e=$(id); if(e) e.textContent = txt; };
const setHTML = (id,html) => { const e=$(id); if(e) e.innerHTML = html; };

// DIAGNÓSTICO
function diag(msg) {
  const el = $("diag-msg");
  if (el) el.textContent = msg;
  console.log("[diagnostic]", msg);
}

// ---------------- Fetch with fallback ----------------
async function tryFetch() {
  diag("Tentando buscar dados do Apps Script...");
  try {
    const res = await fetch(APPSCRIPT_URL + "?_ts=" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (!json || !json.raw) throw new Error("Resposta sem campo 'raw'");
    diag("Dados carregados do Apps Script com sucesso.");
    return { source: "remote", data: json };
  } catch (e) {
    console.warn("Fetch falhou:", e);
    diag("Falha ao buscar Apps Script — usando SAMPLE_JSON de fallback. Veja console para detalhes.");
    if (window.SAMPLE_JSON) {
      return { source: "sample", data: window.SAMPLE_JSON };
    } else {
      diag("Nenhum SAMPLE_JSON disponível.");
      return { source: "none", data: null, error: e };
    }
  }
}

// ---------------- Month helpers ----------------
function extractMonth(r) {
  const ts = r["Timestamp"] || r["Carimbo de data/hora"];
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0,7); // YYYY-MM
}

// ---------------- Normalize / matching ----------------
function normalizeText(s) {
  if (!s) return "";
  return s.toString().toLowerCase().replace(/[“”]/g,'"').replace(/[’‘]/g,"'").replace(/[^a-z0-9\s"']/gi,' ').replace(/\s+/g,' ').trim();
}

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
  for (const em of CATEGORY_ORDER) {
    if (s.indexOf(em) >= 0) return em;
  }
  return null;
}

// ---------------- Filters ----------------
function populateFilters(raw) {
  const combine = (raw.checkin||[]).concat(raw.checkout||[]).concat(raw.avaliacao||[]);
  const turmas = Array.from(new Set(combine.map(r => r["Turma"]).filter(Boolean))).sort();
  const eixos  = Array.from(new Set(combine.map(r => r["Eixo"]).filter(Boolean))).sort();
  const months = Array.from(new Set(combine.map(extractMonth).filter(Boolean))).sort();

  const selT = $("sel-turma"), selE = $("sel-eixo"), selM = $("sel-month");
  [selT,selE,selM].forEach(s => { while (s.options.length>1) s.remove(1); });

  turmas.forEach(t => selT.add(new Option(t,t)));
  eixos.forEach(e => selE.add(new Option(e,e)));
  months.forEach(m => selM.add(new Option(m,m)));

  diag(`Filtros: Turmas(${turmas.length}) Eixos(${eixos.length}) Meses(${months.length})`);
}

function applyFilters(rows) {
  if (!rows) return [];
  const selT = $("sel-turma").value;
  const selE = $("sel-eixo").value;
  const selM = $("sel-month").value;

  return rows.filter(r => {
    if (selT !== "Todos" && (r["Turma"]||"") !== selT) return false;
    if (selE !== "Todos" && (r["Eixo"]||"") !== selE) return false;
    const m = extractMonth(r);
    if (selM !== "Todos" && m !== selM) return false;
    return true;
  });
}

// ---------------- Aggregation ----------------
function countCategoriesForRows(rows) {
  const out = QUESTIONS.map(()=> { const o={}; CATEGORY_ORDER.forEach(e=> o[e]=0); return o; });
  rows.forEach(r => {
    QUESTIONS.forEach((q,qi)=>{
      const val = findResponseForQuestion(r, qi);
      const em = extractEmoji(val);
      if (em && out[qi] && out[qi][em] !== undefined) out[qi][em]++;
    });
  });
  return out;
}

// ---------------- Charts ----------------
const barValuePlugin = {
  id:'barValuePlugin',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((ds,i)=>{
      const meta = chart.getDatasetMeta(i);
      meta.data.forEach(bar=>{
        const val = ds.data[bar.index];
        if (!val) return;
        ctx.save();
        ctx.font = "bold 11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#000";
        const x = bar.x;
        const y = bar.y - 10;
        ctx.fillText(val, x, y);
        ctx.restore();
      });
    });
  }
};

function renderLegend(targetId) {
  const el = $(targetId);
  if (!el) return;
  el.innerHTML = "";
  CATEGORY_ORDER.forEach(em=>{
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
  const datasets = CATEGORY_ORDER.map(em => ({
    label: CATEGORY_LABEL[em],
    data: countsArray.map(q => q[em] || 0),
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
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: { x: { stacked:false }, y: { beginAtZero:true } }
    },
    plugins: [barValuePlugin]
  };

  const ch = new Chart(ctx, cfg);
  if (canvasId === "chart-checkin") chartCheckin = ch;
  if (canvasId === "chart-checkout") chartCheckout = ch;

  renderLegend(legendId);
}

// ---------------- NPS & averages ----------------
function asNumber(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  const n = Number(v.toString().trim().replace(',','.'));
  return isNaN(n) ? NaN : n;
}

function computeNPS(rows, key) {
  const vals = (rows||[]).map(r => asNumber(r[key])).filter(n => !isNaN(n));
  const total = vals.length;
  if (!total) return { nps:null, pctDet:0, pctPro:0 };
  const detr = vals.filter(v => v >=0 && v <=6).length;
  const prom = vals.filter(v => v === 9 || v === 10).length;
  const pctDet = (detr/total)*100;
  const pctPro = (prom/total)*100;
  const nps = pctPro - pctDet;
  return { nps, pctDet, pctPro, total };
}

function average(rows, key) {
  const vals = (rows||[]).map(r=>asNumber(r[key])).filter(n=>!isNaN(n));
  if (!vals.length) return null;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}

// ---------------- AI formatting ----------------
function escapeHtml(t){ return t?.toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || ""; }
function toneFromAverage(avg){ if (avg>=4.5) return "Top! 🎉"; if (avg>=3.5) return "Boa! 😄"; if (avg>=2.5) return "Ok 😐"; return "Pode melhorar 😬"; }

function formatAI(raw, avaliacao) {
  if (!raw) return "Nenhum insight ainda. Clique em Gerar Insights IA.";
  let s = raw.replace(/—/g,"-").replace(/\r/g,"").trim();
  // split into paragraphs by headings or double newlines
  const parts = s.split(/\n{1,}/).map(p=>p.trim()).filter(Boolean);
  const out = parts.map(p => {
    if (p.match(/^#{1,6}\s*/)) {
      const title = p.replace(/^#{1,6}\s*/,'').trim();
      return `<p><strong>${escapeHtml(title)}</strong></p>`;
    } else {
      return `<p>${escapeHtml(p)}</p>`;
    }
  });

  // add professors
  const avg1 = average(avaliacao, "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?");
  const avg2 = average(avaliacao, "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?");
  out.push(`<br/><p><strong>👩‍🏫 Professores</strong></p>`);
  if (avg1 !== null) out.push(`<p>Professor 1: ${avg1.toFixed(1)} — ${toneFromAverage(avg1)}</p>`);
  if (avg2 !== null) out.push(`<p>Professor 2: ${avg2.toFixed(1)} — ${toneFromAverage(avg2)}</p>`);
  out.push(`<br/><p>✨ É isso — insights rápidos e práticos! 😄</p>`);

  return out.join('');
}

// ---------------- Fetch insights ----------------
async function fetchInsights() {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: Date.now() });
    const t = $("sel-turma").value; if (t !== "Todos") params.set("turma", t);
    const e = $("sel-eixo").value; if (e !== "Todos") params.set("eixo", e);
    const m = $("sel-month").value; if (m !== "Todos") params.set("month", m);

    const res = await fetch(APPSCRIPT_URL + "?" + params.toString());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();

    const raw = json.ai?.resumo || json.ai?.text || json.text || "";
    const formatted = formatAI(raw, json.raw?.avaliacao || []);
    localStorage.setItem(AI_KEY, formatted);
    $("insightBox").innerHTML = formatted;
    diag("Insight IA gerado e salvo localmente.");
  } catch (err) {
    console.error(err);
    diag("Erro ao gerar insight (veja console).");
    alert("Erro ao gerar insight (ver console).");
  }
}

// ---------------- Render all ----------------
async function renderAll() {
  const result = await tryFetch();
  if (!result || !result.data) {
    diag("Sem dados para renderizar.");
    return;
  }
  const json = result.data;
  const raw = json.raw || json; // fallback in case SAMPLE_JSON is raw directly

  // diagnostic: show top-level keys
  diag(`Dados prontos (source=${result.source}). Keys raw: ${raw && Object.keys(raw).join(', ')}`);

  // populate filters
  populateFilters(raw);

  // apply filters
  const checkinRows = applyFilters(raw.checkin || []);
  const checkoutRows = applyFilters(raw.checkout || []);
  const avaliacaoRows = applyFilters(raw.avaliacao || []);

  // counts
  const countsIn = countCategoriesForRows(checkinRows);
  const countsOut = countCategoriesForRows(checkoutRows);

  // create charts
  createChart("chart-checkin", "legend-checkin", countsIn);
  createChart("chart-checkout", "legend-checkout", countsOut);

  // NPS and breakdown
  const npsObj = computeNPS(avaliacaoRows, "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?");
  setText("metric-nps-rec", npsObj.nps === null ? "—" : (Math.round(npsObj.nps*10)/10).toFixed(1));
  setText("nps-pct-detr", npsObj.pctDet !== undefined ? (Math.round(npsObj.pctDet*10)/10).toFixed(1) + "%" : "—");
  setText("nps-pct-prom", npsObj.pctPro !== undefined ? (Math.round(npsObj.pctPro*10)/10).toFixed(1) + "%" : "—");

  // averages
  const avgAuto = average(avaliacaoRows, "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?");
  const avgP1 = average(avaliacaoRows, "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?");
  const avgP2 = average(avaliacaoRows, "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?");
  setText("metric-nps-auto", avgAuto === null ? "—" : avgAuto.toFixed(2));
  setText("metric-nps-prof1", avgP1 === null ? "—" : avgP1.toFixed(2));
  setText("metric-nps-prof2", avgP2 === null ? "—" : avgP2.toFixed(2));

  // AI summary persistence: if saved -> keep; else if json.ai present -> save
  const saved = localStorage.getItem(AI_KEY);
  if (saved && saved.length) {
    $("insightBox").innerHTML = saved;
  } else if (json.ai || json.text) {
    const rawAi = json.ai?.resumo || json.ai?.text || json.text;
    const formatted = formatAI(rawAi, raw.avaliacao || []);
    localStorage.setItem(AI_KEY, formatted);
    $("insightBox").innerHTML = formatted;
  } else {
    // nothing: leave existing or default message
    if (!saved) $("insightBox").innerHTML = "Clique em 'Gerar Insights IA' para obter o resumo.";
  }

  setText("last-update", "Última atualização: " + new Date().toLocaleString());
}

// ---------------- Events ----------------
$("btn-refresh").addEventListener("click", () => renderAll());
$("btn-insights").addEventListener("click", () => fetchInsights());
$("diag-show-json").addEventListener("click", () => {
  const html = `<pre style="max-height:320px;overflow:auto;background:#111;color:#fff;padding:12px;border-radius:6px;">${escapeHtml(JSON.stringify(window.SAMPLE_JSON || {}, null, 2))}</pre>`;
  const box = document.createElement("div");
  box.innerHTML = html;
  const w = window.open("", "_blank");
  w.document.write(html);
  w.document.close();
});

// filters change do NOT auto-render; user must click Atualizar (como solicitado)
["sel-turma","sel-eixo","sel-month"].forEach(id => {
  $(id).addEventListener("change", () => { /* manual update only */ });
});

// ---------------- Auto refresh ----------------
function startAutoRefresh() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(() => renderAll(), AUTO_REFRESH_MS);
}

// ---------------- Init ----------------
window.addEventListener("load", () => {
  // restore AI if exists
  const saved = localStorage.getItem(AI_KEY);
  if (saved) $("insightBox").innerHTML = saved;

  renderAll();
  startAutoRefresh();
});
