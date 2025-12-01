// =============================
// CONFIG
// =============================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec";
const AUTO_REFRESH_MS = 45000; // 45s

// perguntas canônicas (fixas)
const QUESTIONS = [
  "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
  "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];
const ABBR = ["Autocontrole", "Nomear emoções", "Autoconfiança", "Relacionamento"];

// categorias / emojis
const CATEGORY_ORDER = ["😞","😬","🙂","😀"];
const CATEGORY_LABEL = { "😞":"Ruim", "😬":"Regular", "🙂":"Bom", "😀":"Ótimo" };
const CATEGORY_COLOR = { "😞":"rgba(220,53,69,0.9)", "😬":"rgba(255,159,64,0.9)", "🙂":"rgba(255,205,86,0.9)", "😀":"rgba(75,192,192,0.9)" };

// storage key for IA summary
const AI_KEY = "dashboard_ai_summary_v2";

let chartCheckin = null;
let chartCheckout = null;
let autoTimer = null;

// ------------------ DOM helpers ------------------
const $ = id => document.getElementById(id);
const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
const setHTML = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };

// ------------------ Normalize / matching robust ------------------
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

// keywords for matching each question (robust)
const Q_TOKENS = [
  ["desestabiliz","autocontrol","autocontrole","desestabiliza"],
  ["nomear","emoc","de boa","deboa"],
  ["autoconfian","autoconfiança","autoconfiante","confian"],
  ["relacion","equipe","trabalhar em equipe","relacionamento"]
];

function findResponseForQuestion(row, qIndex) {
  // if exact key exists, return it quick
  const canonical = QUESTIONS[qIndex];
  if (row.hasOwnProperty(canonical)) return row[canonical];

  // otherwise scan keys and match tokens
  for (const key of Object.keys(row)) {
    const k = normalizeText(key);
    for (const token of Q_TOKENS[qIndex]) {
      if (k.includes(token)) return row[key];
    }
  }

  return null;
}

// extract the first known emoji from a response
function extractEmoji(value) {
  if (!value) return null;
  const s = value.toString();
  for (const em of CATEGORY_ORDER) {
    if (s.indexOf(em) >= 0) return em;
  }
  return null;
}

// ------------------ fetch / filters ------------------
async function fetchRaw() {
  try {
    const res = await fetch(APPSCRIPT_URL + "?_ts=" + Date.now());
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return await res.json();
  } catch (e) {
    console.error("fetchRaw error:", e);
    alert("Erro ao buscar dados. Verifique o Apps Script / CORS.");
    return null;
  }
}

function populateFilters(raw) {
  const combine = (raw.checkin || []).concat(raw.checkout || []).concat(raw.avaliacao || []);
  const turmas = Array.from(new Set(combine.map(r => r["Turma"]).filter(Boolean))).sort();
  const eixos  = Array.from(new Set(combine.map(r => r["Eixo"]).filter(Boolean))).sort();
  const months = Array.from(new Set(combine.map(r => r["Timestamp"] || r["Carimbo de data/hora"]).filter(Boolean))).sort();

  const selT = $("sel-turma"), selE = $("sel-eixo"), selM = $("sel-month");
  [selT, selE, selM].forEach(s => { while (s.options.length > 1) s.remove(1); });

  turmas.forEach(t => selT.add(new Option(t,t)));
  eixos.forEach(e => selE.add(new Option(e,e)));
  months.forEach(m => selM.add(new Option(m,m)));
}

function applyFilters(rows) {
  if (!rows) return [];
  const selT = $("sel-turma").value;
  const selE = $("sel-eixo").value;
  const selM = $("sel-month").value;

  return rows.filter(r => {
    if (selT !== "Todos" && (r["Turma"] || "") !== selT) return false;
    if (selE !== "Todos" && (r["Eixo"] || "") !== selE) return false;
    const ts = r["Timestamp"] || r["Carimbo de data/hora"] || "";
    if (selM !== "Todos" && ts !== selM) return false;
    return true;
  });
}

// ------------------ aggregation ------------------
function countCategoriesForRows(rows) {
  // returns object: { questionIndex: { emoji: count } }
  const out = QUESTIONS.map(() => {
    const obj = {}; CATEGORY_ORDER.forEach(e=>obj[e]=0); return obj;
  });

  rows.forEach(r => {
    QUESTIONS.forEach((q, qi) => {
      const val = findResponseForQuestion(r, qi);
      const em = extractEmoji(val);
      if (em && out[qi][em] !== undefined) out[qi][em] += 1;
    });
  });

  return out; // array indexed by question index
}

// ------------------ charts ------------------
const barValuePlugin = {
  id: 'barValuePlugin',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((dataset, i) => {
      const meta = chart.getDatasetMeta(i);
      meta.data.forEach((bar, idx) => {
        const val = dataset.data[idx];
        if (!val) return;
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const x = bar.x;
        const y = (bar.y + bar.base) / 2;
        const height = Math.abs(bar.base - bar.y);
        if (height < 14) {
          ctx.fillStyle = '#000';
          ctx.fillText(val, x, bar.y - 8);
        } else {
          ctx.fillText(val, x, y);
        }
        ctx.restore();
      });
    });
  }
};

function renderLegend(elementId) {
  const el = $(elementId);
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
  // countsArray: array length QUESTIONS, each an object {emoji:count}
  const labels = ABBR.slice();
  const datasets = CATEGORY_ORDER.map(em => ({
    label: `${CATEGORY_LABEL[em]}`,
    data: countsArray.map(qObj => qObj[em] || 0),
    backgroundColor: CATEGORY_COLOR[em]
  }));

  const ctx = $(canvasId).getContext('2d');
  // destroy existing
  if (canvasId === 'chart-checkin' && chartCheckin) { chartCheckin.destroy(); chartCheckin = null; }
  if (canvasId === 'chart-checkout' && chartCheckout) { chartCheckout.destroy(); chartCheckout = null; }

  const cfg = {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: { x: { stacked: false }, y: { beginAtZero: true } }
    },
    plugins: [barValuePlugin]
  };

  const chart = new Chart(ctx, cfg);
  if (canvasId === 'chart-checkin') chartCheckin = chart;
  if (canvasId === 'chart-checkout') chartCheckout = chart;

  renderLegend(legendId);
}

// ------------------ NPS / médias ------------------
function asNumber(v) {
  if (typeof v === 'number') return v;
  if (!v && v !== 0) return NaN;
  const s = v.toString().trim().replace(',', '.');
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}

function computeNPS(avRows, key) {
  const vals = (avRows || []).map(r => asNumber(r[key])).filter(n => !isNaN(n));
  const total = vals.length;
  if (!total) return { nps: null, pctDet: 0, pctPro: 0 };
  const detr = vals.filter(v => v >= 0 && v <= 6).length;
  const neut = vals.filter(v => v === 7 || v === 8).length;
  const prom = vals.filter(v => v === 9 || v === 10).length;
  const pctDet = (detr / total) * 100;
  const pctPro = (prom / total) * 100;
  const nps = pctPro - pctDet;
  return { nps, pctDet, pctPro, total, detr, neut, prom };
}

function average(avRows, key) {
  const vals = (avRows || []).map(r => asNumber(r[key])).filter(n => !isNaN(n));
  if (!vals.length) return null;
  const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
  return avg;
}

// ------------------ AI Summary formatting (informal + fun) ------------------
function formatAI(rawText, avaliacao) {
  if (!rawText) return "Sem resumo da IA.";
  // Remove weird long dashes, unify line endings
  let s = rawText.replace(/—/g,'-').replace(/\r/g,'').trim();

  // If it's one big line with '###', split by headings
  // We'll convert headings to bold and ensure line breaks between insights
  // Also append compact professor averages (fun)
  // break on multiple newlines
  const parts = s.split(/\n{1,}/).map(p => p.trim()).filter(Boolean);

  // Merge parts into paragraphs, replace markdown headings
  const out = [];
  parts.forEach(p => {
    if (p.match(/^#{1,6}\s*/)) {
      const t = p.replace(/^#{1,6}\s*/, '').trim();
      out.push(`<p><strong>${escapeHtml(t)}</strong></p>`);
    } else {
      out.push(`<p>${escapeHtml(p)}</p>`);
    }
  });

  // Add professor quick eval from avaliacao averages (if available)
  const avg1 = average(avaliacao, "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?");
  const avg2 = average(avaliacao, "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?");
  if (avg1 !== null || avg2 !== null) {
    out.push(`<br/><p><strong>Professores</strong></p>`);
    if (avg1 !== null) out.push(`<p>🧑‍🏫 Professor 1: média ${avg1.toFixed(1)} — ${toneFromAverage(avg1)}</p>`);
    if (avg2 !== null) out.push(`<p>🧑‍🏫 Professor 2: média ${avg2.toFixed(1)} — ${toneFromAverage(avg2)}</p>`);
  }

  // Make language lighter by collapsing repeated punctuation (just a tiny cleanup)
  return out.join('');
}

function toneFromAverage(avg) {
  if (avg >= 4.5) return "Top! 🎉";
  if (avg >= 3.5) return "Legal 👍";
  if (avg >= 2.5) return "OK";
  return "Pode melhorar";
}

function escapeHtml(text) {
  return text
    .toString()
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// ------------------ Insights (call backend) ------------------
async function fetchInsights() {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: Date.now() });
    const turma = $("sel-turma").value; if (turma !== "Todos") params.set("turma", turma);
    const eixo  = $("sel-eixo").value;  if (eixo !== "Todos") params.set("eixo", eixo);
    const month = $("sel-month").value; if (month !== "Todos") params.set("month", month);

    const res = await fetch(APPSCRIPT_URL + "?" + params.toString());
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    const raw = json.ai?.resumo || json.ai?.text || json.text || (json && json.raw && json.raw.ai) || null;
    const formatted = formatAI(raw, json.raw?.avaliacao || []);
    // save to localStorage so auto-refresh doesn't overwrite
    localStorage.setItem(AI_KEY, formatted);
    $("insightBox").innerHTML = formatted;
  } catch (e) {
    console.error("fetchInsights error", e);
    alert("Erro ao gerar insights (veja console).");
  }
}

// ------------------ Main render flow ------------------
async function renderAll() {
  const json = await fetchRaw();
  if (!json || !json.raw) return;
  const raw = json.raw;

  // update last update
  setText("last-update", "Última: " + new Date().toLocaleString());

  // populate filters once
  populateFilters(raw);

  // apply filters
  const checkin = applyFilters(raw.checkin || []);
  const checkout = applyFilters(raw.checkout || []);
  const avaliacao = applyFilters(raw.avaliacao || []);

  // counts
  const countsCheckin = countCategoriesForRows(checkin);
  const countsCheckout = countCategoriesForRows(checkout);

  // render two charts
  createChart('chart-checkin', 'legend-checkin', countsCheckin);
  createChart('chart-checkout', 'legend-checkout', countsCheckout);

  // NPS and averages
  const npsObj = computeNPS(avaliacao, "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?");
  setText('metric-nps-rec', npsObj.nps === null ? '—' : (Math.round(npsObj.nps * 10)/10).toFixed(1));
  setText('nps-pct-detr', npsObj.pctDet !== undefined ? (Math.round(npsObj.pctDet*10)/10).toFixed(1) + '%' : '—');
  setText('nps-pct-prom', npsObj.pctPro !== undefined ? (Math.round(npsObj.pctPro*10)/10).toFixed(1) + '%' : '—');

  const avgAuto = average(avaliacao, "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?");
  const avgP1 = average(avaliacao, "Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?");
  const avgP2 = average(avaliacao, "Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?");
  setText('metric-nps-auto', avgAuto === null ? '—' : avgAuto.toFixed(2));
  setText('metric-nps-prof1', avgP1 === null ? '—' : avgP1.toFixed(2));
  setText('metric-nps-prof2', avgP2 === null ? '—' : avgP2.toFixed(2));

  // AI summary persistence: do not overwrite existing saved summary
  const saved = localStorage.getItem(AI_KEY);
  if (saved && saved.length > 0) {
    // show saved summary
    $("insightBox").innerHTML = saved;
  } else {
    // if none saved, but backend returned a precomputed ai, use formatted but still store it
    if (json.ai || json.text) {
      const rawAi = json.ai?.resumo || json.ai?.text || json.text;
      const formatted = formatAI(rawAi, raw.avaliacao || []);
      localStorage.setItem(AI_KEY, formatted);
      $("insightBox").innerHTML = formatted;
    }
  }
}

// ------------------ Events ------------------
$('btn-refresh').addEventListener('click', () => { renderAll(); });
$('btn-insights').addEventListener('click', () => { fetchInsights(); });

// filters change -> do NOT auto-trigger render; user must click Atualizar
['sel-turma','sel-eixo','sel-month'].forEach(id => {
  $(id).addEventListener('change', () => { /* no auto render - manual refresh preferred */ });
});

// ------------------ Auto-refresh (45s) ------------------
function startAuto() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(() => { renderAll(); }, AUTO_REFRESH_MS);
}

// ------------------ init ------------------
window.addEventListener('load', () => {
  // restore AI if any
  const saved = localStorage.getItem(AI_KEY);
  if (saved) $("insightBox").innerHTML = saved;
  // initial load + start auto refresh
  renderAll();
  startAuto();
});
