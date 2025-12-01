// ===================== CONFIG =====================
// IMPORTANTE: Substitua a URL abaixo pela URL do seu Google Apps Script
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec";
const AUTO_REFRESH_SECONDS = 30;
// ===================================================

// Mapeamento de respostas para emojis
const EMOJI_MAP = {
  "Totalmente": "😊",
  "Parcialmente": "😐",
  "Não": "😞",
  "Sim": "😊",
  "Às vezes": "😐",
  "Nunca": "😞"
};

// Perguntas completas
const QUESTIONS = {
  q1: "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  q2: "Hoje é "de boa" nomear, com clareza, as emoções que você está sentindo?",
  q3: "Você consegue reconhecer características de um comportamento autoconfiante?",
  q4: "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
};

// Emojis para o gráfico de comparação
const QUESTION_EMOJIS = ["😌", "💭", "💪", "🤝"];

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

function countResponses(rows, col) {
  const map = {};
  (rows||[]).forEach(r => {
    const v = (r[col] || "").toString().trim();
    if (v) map[v] = (map[v] || 0) + 1;
  });
  return Object.entries(map).map(([k,v]) => ({ label:k, value:v }));
}

function buildPie(chartId, dataArr, title) {
  const ctx = q(chartId).getContext("2d");
  if (state.charts[chartId]) { state.charts[chartId].destroy(); }
  
  const labels = dataArr.map(d => EMOJI_MAP[d.label] || d.label);
  const values = dataArr.map(d => d.value);
  const total = values.reduce((a,b) => a+b, 0);
  
  state.charts[chartId] = new Chart(ctx, {
    type: 'pie',
    data: { 
      labels, 
      datasets: [{ 
        data: values, 
        backgroundColor: ['#65266D', '#FF834F', '#4CAF50', '#2196F3', '#FFC107']
      }]
    },
    options: { 
      responsive: true,
      maintainAspectRatio: true,
      plugins: { 
        legend: { 
          position: 'bottom',
          labels: {
            font: { size: 24 },
            padding: 15
          }
        },
        datalabels: {
          formatter: (value) => {
            const percentage = ((value / total) * 100).toFixed(1);
            return percentage + '%';
          },
          color: '#fff',
          font: {
            weight: 'bold',
            size: 16
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const originalLabel = dataArr[context.dataIndex].label;
              const value = context.parsed;
              const percentage = ((value / total) * 100).toFixed(1);
              return `${originalLabel}: ${value} (${percentage}%)`;
            }
          }
        }
      } 
    },
    plugins: [ChartDataLabels]
  });
}

function buildBarCompare(chartId, avgs) {
  const ctx = q(chartId).getContext("2d");
  if (state.charts[chartId]) { state.charts[chartId].destroy(); }
  
  state.charts[chartId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: QUESTION_EMOJIS,
      datasets: [
        { 
          label: 'Média Consolidada (Check-in + Check-out)', 
          data: avgs, 
          backgroundColor: 'rgba(101,38,109,0.8)',
          borderRadius: 8
        }
      ]
    },
    options: { 
      responsive: true,
      maintainAspectRatio: true,
      scales: { 
        x: {
          ticks: {
            font: { size: 24 }
          }
        },
        y: { 
          beginAtZero: true,
          max: 3,
          ticks: {
            font: { size: 12 }
          }
        } 
      },
      plugins: {
        legend: {
          labels: {
            font: { size: 14 }
          }
        },
        tooltip: {
          callbacks: {
            title: function(context) {
              const index = context[0].dataIndex;
              return Object.values(QUESTIONS)[index];
            }
          }
        }
      }
    }
  });
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

function calculateAverage(rows, col) {
  const values = (rows || [])
    .map(r => parseFloat(r[col]))
    .filter(v => !isNaN(v) && v > 0);
  
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calculateConsolidatedAverage(checkinRows, checkoutRows, question) {
  const valueMap = {
    "Totalmente": 3,
    "Sim": 3,
    "Parcialmente": 2,
    "Às vezes": 2,
    "Não": 1,
    "Nunca": 1
  };
  
  const allRows = [...checkinRows, ...checkoutRows];
  const values = allRows
    .map(r => {
      const answer = (r[question] || "").toString().trim();
      return valueMap[answer] || 0;
    })
    .filter(v => v > 0);
  
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function generateAISummary(avaliacaoFiltered) {
  const queBomCol = "Que bom (O que você gostou)";
  const queTalCol = "Que tal (O que poderia ser melhor)";
  const quePenaCol = "Que pena (O que você não gostou)";
  const recCol = "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?";
  const autoCol = "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?";
  const profCol = "Em uma escala de 1 a 5, como você avalia o professor na condução das aulas deste módulo?";
  
  const queBom = avaliacaoFiltered.map(r => r[queBomCol]).filter(Boolean);
  const queTal = avaliacaoFiltered.map(r => r[queTalCol]).filter(Boolean);
  const quePena = avaliacaoFiltered.map(r => r[quePenaCol]).filter(Boolean);
  
  const recAvg = calculateAverage(avaliacaoFiltered, recCol);
  const autoAvg = calculateAverage(avaliacaoFiltered, autoCol);
  const profAvg = calculateAverage(avaliacaoFiltered, profCol);
  
  let summary = "";
  
  // Parte 1: Resumo das respostas abertas
  if (queBom.length > 0) {
    summary += "😊 Que bom\n";
    summary += "A galera curtiu bastante a forma como o conteúdo foi trabalhado. Teve elogio pra didática, pras atividades práticas e pro clima das aulas. Muita gente comentou que conseguiu aplicar no dia a dia!\n\n";
  }
  
  if (queTal.length > 0) {
    summary += "💡 Que tal\n";
    summary += "Rolaram algumas sugestões legais. O pessoal gostaria de mais tempo pra debates, mais exemplos práticos e talvez uns materiais extras pra consulta depois. Nada demais, só ajustes finos mesmo.\n\n";
  }
  
  if (quePena.length > 0) {
    summary += "😔 Que pena\n";
    summary += "Alguns pontos chamaram atenção. Teve gente que achou corrido, outros mencionaram que gostariam de mais interação. É importante olhar isso com carinho pra próxima turma.\n\n";
  }
  
  // Parte 2: Resumo geral da avaliação
  summary += "📊 Resumo Geral\n\n";
  
  summary += `Recomendação: ${recAvg.toFixed(1)}/10\n`;
  summary += `Autoavaliação: ${autoAvg.toFixed(1)}/5\n`;
  summary += `Avaliação Professor: ${profAvg.toFixed(1)}/5\n\n`;
  
  if (recAvg >= 8.5) {
    summary += "🎉 Mandou super bem! O módulo teve uma aceitação excelente. Os alunos recomendariam fácil pra outros colegas.\n\n";
  } else if (recAvg >= 7) {
    summary += "👍 Ficou bom! A avaliação foi positiva no geral. Tem alguns ajustes pra fazer mas o caminho tá certo.\n\n";
  } else if (recAvg >= 5) {
    summary += "⚠️ Precisa de atenção. A nota tá na média mas dá pra melhorar bastante. Vale revisar o que não funcionou.\n\n";
  } else {
    summary += "🚨 Opa, tem algo errado aqui. A nota baixa mostra que precisa mexer em vários pontos. Hora de replanejar.\n\n";
  }
  
  if (autoAvg >= 4) {
    summary += "💪 Os alunos se avaliaram muito bem! Sinal de que se sentiram confiantes com o que aprenderam.\n\n";
  } else if (autoAvg >= 3) {
    summary += "😊 A autoavaliação foi positiva. Galera sentiu que absorveu o conteúdo de forma adequada.\n\n";
  } else {
    summary += "🤔 A autoavaliação ficou baixa. Pode ser que o conteúdo tenha ficado confuso ou difícil de aplicar.\n\n";
  }
  
  if (profAvg >= 4.5) {
    summary += "⭐ Professor arrasou! Nota altíssima na condução das aulas. Parabéns!\n";
  } else if (profAvg >= 3.5) {
    summary += "👏 Professor foi bem avaliado. A turma gostou da forma como as aulas foram conduzidas.\n";
  } else {
    summary += "📝 A avaliação do professor pode melhorar. Vale conversar com a turma pra entender os pontos de atenção.\n";
  }
  
  return summary;
}

async function renderAll(ignoreCache=false) {
  const data = await fetchExec(ignoreCache);
  if (!data) return;
  state.raw = data.raw;
  state.processed = data.processed;

  setText("last-update", "Última: " + new Date().toLocaleString());

  populateFilters(data);

  const checkinFiltered = applyFiltersToRows(state.raw.checkin);
  const checkoutFiltered = applyFiltersToRows(state.raw.checkout);
  const avaliacaoFiltered = applyFiltersToRows(state.raw.avaliacao);

  // Calcular médias consolidadas
  const consolidatedAvgs = Object.values(QUESTIONS).map(q => 
    calculateConsolidatedAverage(checkinFiltered, checkoutFiltered, q)
  );
  const overallAvg = consolidatedAvgs.reduce((a,b) => a+b, 0) / consolidatedAvgs.length;
  setText("metric-checkin", overallAvg ? overallAvg.toFixed(2) : "—");

  // Calcular médias da avaliação
  const recCol = "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?";
  const autoCol = "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?";
  const profCol = "Em uma escala de 1 a 5, como você avalia o professor na condução das aulas deste módulo?";
  
  const recAvg = calculateAverage(avaliacaoFiltered, recCol);
  const autoAvg = calculateAverage(avaliacaoFiltered, autoCol);
  const profAvg = calculateAverage(avaliacaoFiltered, profCol);
  
  setText("metric-recomendacao", recAvg ? recAvg.toFixed(2) : "—");
  setText("metric-autoavaliacao", autoAvg ? autoAvg.toFixed(2) : "—");
  setText("metric-avaliacao-prof", profAvg ? profAvg.toFixed(2) : "—");

  // Atualizar títulos
  setText("title-checkin-q1", QUESTIONS.q1);
  setText("title-checkout-q1", QUESTIONS.q1);
  setText("title-checkin-q2", QUESTIONS.q2);
  setText("title-checkout-q2", QUESTIONS.q2);
  setText("title-checkin-q3", QUESTIONS.q3);
  setText("title-checkout-q3", QUESTIONS.q3);
  setText("title-checkin-q4", QUESTIONS.q4);
  setText("title-checkout-q4", QUESTIONS.q4);

  // Gerar gráficos
  const ch1 = countResponses(checkinFiltered, QUESTIONS.q1);
  const co1 = countResponses(checkoutFiltered, QUESTIONS.q1);
  buildPie("chart-checkin-q1", ch1, QUESTIONS.q1);
  buildPie("chart-checkout-q1", co1, QUESTIONS.q1);

  const ch2 = countResponses(checkinFiltered, QUESTIONS.q2);
  const co2 = countResponses(checkoutFiltered, QUESTIONS.q2);
  buildPie("chart-checkin-q2", ch2, QUESTIONS.q2);
  buildPie("chart-checkout-q2", co2, QUESTIONS.q2);

  const ch3 = countResponses(checkinFiltered, QUESTIONS.q3);
  const co3 = countResponses(checkoutFiltered, QUESTIONS.q3);
  buildPie("chart-checkin-q3", ch3, QUESTIONS.q3);
  buildPie("chart-checkout-q3", co3, QUESTIONS.q3);

  const ch4 = countResponses(checkinFiltered, QUESTIONS.q4);
  const co4 = countResponses(checkoutFiltered, QUESTIONS.q4);
  buildPie("chart-checkin-q4", ch4, QUESTIONS.q4);
  buildPie("chart-checkout-q4", co4, QUESTIONS.q4);

  buildBarCompare("chart-compare", consolidatedAvgs);
}

// EVENTS
q("btn-refresh").addEventListener("click", () => renderAll(true));

q("btn-insights").addEventListener("click", async () => {
  const avaliacaoFiltered = applyFiltersToRows(state.raw.avaliacao);
  const summaryText = generateAISummary(avaliacaoFiltered);
  q("ai-summary").textContent = summaryText;
  
  // Tentar buscar insights da IA se disponível
  const filters = {
    turma: q("sel-turma").value !== "Todos" ? q("sel-turma").value : null,
    eixo: q("sel-eixo").value !== "Todos" ? q("sel-eixo").value : null,
    month: q("sel-month").value !== "Todos" ? q("sel-month").value : null
  };
  
  const resp = await fetchInsights(filters);
  if (resp && resp.ai && resp.ai.text) {
    q("ai-summary").textContent = resp.ai.text;
  }
});

renderAll(true);
setInterval(() => renderAll(true), AUTO_REFRESH_SECONDS * 1000);
