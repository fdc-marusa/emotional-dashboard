// ===================== CONFIG =====================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec"; // <<--- seu endpoint
const AUTO_REFRESH_SECONDS = 30; // polling interval
// ===================================================

let state = { raw: null, processed: null, charts: {} };

// emojis usados para representar datasets
const LEG_EMOJI = { checkin: '🟣', checkout: '🟠' };

// plugin para escrever percentuais dentro de cada fatia (Chart.js v4)
const slicePercentPlugin = {
  id: 'slicePercent',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta || !meta.data) return;
      const total = dataset.data.reduce((a,b) => a + (Number(b)||0), 0);
      meta.data.forEach((arc, i) => {
        const value = Number(dataset.data[i]) || 0;
        const percent = total ? Math.round((value / total) * 100) : 0;
        // calc posição média do arco
        const angle = (arc.startAngle + arc.endAngle) / 2;
        const r = (arc.outerRadius + (arc.innerRadius || 0)) / 2;
        const x = arc.x + Math.cos(angle) * r;
        const y = arc.y + Math.sin(angle) * r;
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(percent + '%', x, y);
        ctx.restore();
      });
    });
  }
};

// ===================== FETCH =====================
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
function setHTML(id, html){ const el = q(id); if (el) el.innerHTML = html; }

// populate filters
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

// conta respostas (para pie)
function countResponses(rows, col) {
  const map = {};
  (rows||[]).forEach(r => {
    const v = (r[col] || "").toString();
    map[v] = (map[v] || 0) + 1;
  });
  return Object.entries(map).map(([k,v]) => ({ label:k, value:v }));
}

// mapeia labels comuns para emoji (fallback: retorna label original)
function mapLabelToEmoji(label) {
  if (!label) return label;
  const s = label.toString().trim().toLowerCase();
  const map = {
    'sim': '✅',
    'não': '❌',
    'nao': '❌',
    'às vezes': '🤔',
    'as vezes': '🤔',
    'mais ou menos': '🤷',
    'prefiro não responder': '🤫',
    'prefiro nao responder': '🤫',
    'muito': '😃',
    'pouco': '😕',
    'não sei': '❓',
    'nao sei': '❓',
    'talvez': '🤷'
  };
  // se encontrou exato
  for (const k of Object.keys(map)) {
    if (s === k) return map[k];
  }
  // tentativa de detecção por palavras
  if (s.includes('sim')) return '✅';
  if (s.includes('não') || s.includes('nao')) return '❌';
  if (s.includes('bom') || s.includes('gostei')) return '✨';
  if (s.includes('ruim') || s.includes('não gostei') || s.includes('nao gostei')) return '😕';
  // fallback: voltar texto original (pois não há emoji específico)
  return label;
}

// gera paleta
function generateColors(n){
  const palette = ['#65266D','#FF834F','#4CAF50','#2196F3','#FFC107','#9C27B0','#00BCD4'];
  const out = [];
  for(let i=0;i<n;i++) out.push(palette[i % palette.length]);
  return out;
}

// construir pie com percentuais dentro das fatias e legenda com mapping de emoji quando possível
function buildPie(chartId, dataArr, title) {
  const ctx = q(chartId).getContext("2d");
  if (state.charts[chartId]) { state.charts[chartId].destroy(); }
  const labels = dataArr.map(d=>d.label);
  const values = dataArr.map(d=>d.value);
  const colors = generateColors(values.length);

  state.charts[chartId] = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data: values, backgroundColor: colors }]},
    options: {
      responsive:true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            // transforma as legendas em emoji quando possível (apenas texto curto)
            generateLabels: chart => {
              return chart.data.labels.map((lbl, i) => {
                const text = mapLabelToEmoji(lbl) || lbl;
                return {
                  text,
                  fillStyle: chart.data.datasets[0].backgroundColor[i],
                  strokeStyle: chart.data.datasets[0].backgroundColor[i],
                  hidden: false,
                  index: i
                };
              });
            }
          }
        },
        title: { display: false, text: title }
      },
      maintainAspectRatio: false
    },
    plugins: [slicePercentPlugin]
  });
}

// construir gráfico de comparação (legendas com emoji)
function buildBarCompare(chartId, questions, checkinAvgs, checkoutAvgs) {
  const ctx = q(chartId).getContext("2d");
  if (state.charts[chartId]) { state.charts[chartId].destroy(); }
  const labels = questions;
  state.charts[chartId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: LEG_EMOJI.checkin, data: checkinAvgs, backgroundColor: 'rgba(101,38,109,0.8)' },
        { label: LEG_EMOJI.checkout, data: checkoutAvgs, backgroundColor: 'rgba(255,131,79,0.8)' }
      ]
    },
    options: {
      responsive:true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            // garante que a legenda mostre apenas o emoji (o label já foi definido como emoji)
            generateLabels: chart => {
              return chart.data.datasets.map((ds, i) => ({
                text: ds.label,
                fillStyle: ds.backgroundColor,
                hidden: false,
                index: i
              }));
            }
          }
        }
      },
      scales:{ y:{ beginAtZero:true } }
    }
  });
}

// filtros
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

// tenta extrair média de um objeto perQuestion (proc)
function readAvgObj(o) {
  if (!o) return null;
  if (o.avg_score !== undefined) return Number(o.avg_score);
  if (o.avg !== undefined) return Number(o.avg);
  return null;
}

// calcula média consolidada por pergunta (combina checkin + checkout)
// usa counts se disponíveis (proc.perQuestion[...].count), senão faz média simples ponderada onde possível
function computeCombinedAvg(question) {
  if (!state.processed) return 0;
  const pc = state.processed.checkin && state.processed.checkin.perQuestion && state.processed.checkin.perQuestion[question];
  const po = state.processed.checkout && state.processed.checkout.perQuestion && state.processed.checkout.perQuestion[question];
  const candidates = [];

  if (pc) {
    const avg = readAvgObj(pc);
    const count = (pc.count || pc.n || 0);
    if (avg !== null) {
      if (count) candidates.push({ sum: avg * count, count: count });
      else candidates.push({ sum: avg, count: 1 });
    }
  }
  if (po) {
    const avg = readAvgObj(po);
    const count = (po.count || po.n || 0);
    if (avg !== null) {
      if (count) candidates.push({ sum: avg * count, count: count });
      else candidates.push({ sum: avg, count: 1 });
    }
  }

  if (!candidates.length) return 0;
  const totalSum = candidates.reduce((s,c)=>s+c.sum,0);
  const totalCount = candidates.reduce((s,c)=>s+c.count,0);
  return totalCount ? (totalSum / totalCount) : (totalSum / candidates.length);
}

// calcula média geral de todos os per-questions já consolidados
function combinedAverageAllQuestions() {
  const checkinQs = state.processed && state.processed.checkin && state.processed.checkin.perQuestion ? Object.keys(state.processed.checkin.perQuestion) : [];
  const checkoutQs = state.processed && state.processed.checkout && state.processed.checkout.perQuestion ? Object.keys(state.processed.checkout.perQuestion) : [];
  const setAll = new Set([...checkinQs, ...checkoutQs]);
  const arr = Array.from(setAll).map(q => computeCombinedAvg(q)).filter(n => n && !isNaN(n));
  if (!arr.length) return 0;
  return arr.reduce((a,b)=>a+b,0) / arr.length;
}

// Helper: pega média da aba avaliacao por pergunta (se existir)
function getAvaliacaoAvgByKey(key) {
  if (!state.processed || !state.processed.avaliacao || !state.processed.avaliacao.perQuestion) return 0;
  const obj = state.processed.avaliacao.perQuestion[key];
  if (!obj) return 0;
  const v = obj.avg_score || obj.avg || obj.value || obj.mean;
  return v ? Number(v) : 0;
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

  // MÉTRICAS: média consolidada por pergunta (checkin+checkout)
  const combinedAvgOverall = combinedAverageAllQuestions();
  setText("metric-consolidada", combinedAvgOverall ? combinedAvgOverall.toFixed(2) : "—");

  // Mantive métrica de checkout geral como antes (opcional)
  const checkoutAvgOverall = averageOfObjectValues(state.processed.checkout.perQuestion || {});
  setText("metric-checkout", checkoutAvgOverall ? checkoutAvgOverall.toFixed(2) : "—");

  // AVALIAÇÕES: chave exata das perguntas (ajuste se seus textos forem diferentes)
  const keyRec = "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?";
  const keyAuto = "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?";
  const keyProf = "Em uma escala de 1 a 5, como você avalia o professor na condução das aulas deste módulo?";

  setText("metric-avaliacao", (() => {
    const v = getAvaliacaoAvgByKey(keyRec);
    return v ? v.toFixed(2) : "—";
  })());

  setText("metric-avaliacao-auto", (() => {
    const v = getAvaliacaoAvgByKey(keyAuto);
    return v ? v.toFixed(2) : "—";
  })());

  setText("metric-avaliacao-prof", (() => {
    const v = getAvaliacaoAvgByKey(keyProf);
    return v ? v.toFixed(2) : "—";
  })());

  // PREPARAR CHARTS
  // perguntas completas usadas no front (usar os textos exatamente como nas colunas)
  const q1 = "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?";
  const q2 = "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?";
  const q3 = "Você consegue reconhecer características de um comportamento autoconfiante?";
  const q4 = "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?";

  // atualiza títulos no HTML (mostra a pergunta por extenso)
  setText("h-checkin-q1", `Check-in — ${q1}`);
  setText("h-checkout-q1", `Check-out — ${q1}`);
  setText("h-checkin-q2", `Check-in — ${q2}`);
  setText("h-checkout-q2", `Check-out — ${q2}`);
  setText("h-compare", "Comparação (Médias Q1-Q4)");

  const checkinFiltered = applyFiltersToRows(state.raw.checkin);
  const checkoutFiltered = applyFiltersToRows(state.raw.checkout);

  // pie charts: contagens por opção
  const ch1 = countResponses(checkinFiltered, q1);
  const co1 = countResponses(checkoutFiltered, q1);
  buildPie("chart-checkin-q1", ch1, q1);
  buildPie("chart-checkout-q1", co1, q1);

  const ch2 = countResponses(checkinFiltered, q2);
  const co2 = countResponses(checkoutFiltered, q2);
  buildPie("chart-checkin-q2", ch2, q2);
  buildPie("chart-checkout-q2", co2, q2);

  // comparação: médias por pergunta (usando média consolidada por pergunta)
  const questions = [q1, q2, q3, q4];
  const checkinAvgs = questions.map(qs => {
    // preferimos a média do checkin se quiser diferenciar — aqui mantemos as médias individuais
    return computeAvgFromProcessed(state.processed.checkin, qs);
  });
  const checkoutAvgs = questions.map(qs => {
    return computeAvgFromProcessed(state.processed.checkout, qs);
  });

  // legendas do gráfico de comparação serão emojis (definidos em LEG_EMOJI)
  buildBarCompare("chart-compare", questions.map(s => shortLabel(s)), checkinAvgs, checkoutAvgs);
}

// calcula média a partir do objeto perQuestion (utilizada para checkin/checkout individuais)
function computeAvgFromProcessed(proc, question) {
  if (!proc || !proc.perQuestion) return 0;
  const q = proc.perQuestion[question];
  if (!q) return 0;
  const v = q.avg_score || q.avg || q.value || q.mean;
  return v ? Number(v) : 0;
}

function averageOfObjectValues(obj) {
  const vals = Object.values(obj || {}).map(o => o.avg_score || o.avg || 0).filter(v => typeof v === "number");
  if (!vals.length) return 0;
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}

function shortLabel(s) {
  if (!s) return s;
  if (s.length > 36) return s.slice(0,33)+"...";
  return s;
}

// INSIGHTS IA: renderiza 2 tipos de resumo (a) colunas 6/7/8; (b) resumo geral
function renderInsightsResponse(resp) {
  if (!resp || !resp.ai) {
    setText("ai-summary", "Nenhum insight retornado.");
    return;
  }

  // se o backend já retornar estrutura explicitada, usamos diretamente
  const ai = resp.ai;

  // preferência: AI estruturada com campos { queBom, queTal, quePena, resumo }
  if (ai.queBom || ai.queTal || ai.quePena || ai.resumo) {
    const parts = [];
    if (ai.queBom) {
      const lines = Array.isArray(ai.queBom) ? ai.queBom : (ai.queBom.toString().split('\n').filter(Boolean));
      if (lines.length) {
        parts.push(lines.map(l => `✨ ${shortenLine(l)}`).join('<br>'));
      }
    }
    if (ai.queTal) {
      const lines = Array.isArray(ai.queTal) ? ai.queTal : (ai.queTal.toString().split('\n').filter(Boolean));
      if (lines.length) {
        parts.push(lines.map(l => `💡 ${shortenLine(l)}`).join('<br>'));
      }
    }
    if (ai.quePena || ai.quePena === '') {
      const lines = Array.isArray(ai.quePena) ? ai.quePena : (ai.quePena ? ai.quePena.toString().split('\n').filter(Boolean) : []);
      if (lines.length) {
        parts.push(lines.map(l => `😕 ${shortenLine(l)}`).join('<br>'));
      }
    }

    // resumo geral (se existir)
    if (ai.resumo || ai.summary) {
      const summaryText = ai.resumo || ai.summary;
      const lines = summaryText.toString().split('\n').filter(Boolean);
      if (lines.length) parts.push(lines.map(l => `📌 ${shortenLine(l)}`).join('<br>'));
    }

    setHTML("ai-summary", parts.join('<br><br>'));
    return;
  }

  // fallback: se ai.text existir (string livre), tentamos formatar de forma simples
  if (ai.text) {
    // quebra por parágrafo e aplica prefixos curtos
    const blocks = ai.text.toString().split(/\n\n+/).map(b => b.trim()).filter(Boolean);
    const out = blocks.map((b, idx) => {
      // heurística: os primeiros 3 blocos -> Que bom / Que tal / Que pena
      const prefix = idx === 0 ? '✨' : (idx === 1 ? '💡' : (idx === 2 ? '😕' : '📌'));
      return `${prefix} ${shortenLine(b)}`;
    }).join('<br><br>');
    setHTML("ai-summary", out);
    return;
  }

  // se nada, exibir JSON curto (último caso)
  setText("ai-summary", JSON.stringify(ai).slice(0,1000));
}

// corta linha para manter frases curtas (mas sem cortar palavras no meio)
function shortenLine(s, max=110) {
  if (!s) return s;
  s = s.replace(/\s+/g,' ').trim();
  if (s.length <= max) return s;
  // corta no último espaço antes do max
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0,lastSpace) : cut) + '...';
}

// EVENTOS
q("btn-refresh").addEventListener("click", () => renderAll(true));
q("btn-insights").addEventListener("click", async () => {
  const filters = {
    turma: q("sel-turma").value !== "Todos" ? q("sel-turma").value : null,
    eixo: q("sel-eixo").value !== "Todos" ? q("sel-eixo").value : null,
    month: q("sel-month").value !== "Todos" ? q("sel-month").value : null
  };
  const resp = await fetchInsights(filters);
  if (!resp) return;
  renderInsightsResponse(resp);
});

// auto-refresh polling
renderAll(true);
setInterval(() => renderAll(true), AUTO_REFRESH_SECONDS * 1000);
