// ===================== CONFIG - coloque aqui seu URL do Apps Script =====================
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec"; // <<-- substitua
const AUTO_REFRESH_SECONDS = 45; // ajusta o polling se quiser
// =======================================================================================

let state = { raw: null, chart: null };

// perguntas (textos EXATOS como aparecem nas chaves do JSON)
const QUESTIONS = [
  "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
  "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];

// opções: detectamos pelo emoji inicial (prefixo). Ordem nos datasets será: 😞, 😬, 🙂, 😀
const OPTION_EMOJIS = [
  { emoji: "😞", short: "😞 Não consigo / difícil" },
  { emoji: "😬", short: "😬 Mais ou menos" },
  { emoji: "🙂", short: "🙂 Quase sempre" },
  { emoji: "😀", short: "😀 Consigo" }
];

// chaves das três perguntas NPS na aba "avaliacao"
const KEY_REC = "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?";
const KEY_AUTO = "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?";
const KEY_PROF = "Em uma escala de 1 a 5, como você avalia o professor Fernando Oliveira na condução das aulas deste módulo?";

// DOM helpers
const q = id => document.getElementById(id);
const setText = (id, txt) => { const el = q(id); if (el) el.textContent = txt; };
const setHTML = (id, html) => { const el = q(id); if (el) el.innerHTML = html; };

// fetch exec
async function fetchExec() {
  try {
    const url = APPSCRIPT_URL + "?_ts=" + Date.now();
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return await res.json();
  } catch (err) {
    console.error("Erro fetchExec:", err);
    alert("Erro ao buscar dados: " + err.message);
    return null;
  }
}

// popula selects
function populateFilters(raw) {
  const combine = (raw.checkin||[]).concat(raw.checkout||[]).concat(raw.avaliacao||[]);
  const turmas = Array.from(new Set(combine.map(r => r["Turma"]).filter(Boolean))).sort();
  const eixos  = Array.from(new Set(combine.map(r => r["Eixo"]).filter(Boolean))).sort();
  const months = Array.from(new Set(combine.map(r => r["Timestamp"] || r["Carimbo de data/hora"]).filter(Boolean))).sort();

  const selTurma = q("sel-turma");
  const selEixo  = q("sel-eixo");
  const selMonth = q("sel-month");

  [selTurma, selEixo, selMonth].forEach(sel => {
    while (sel.options.length > 1) sel.remove(1);
  });

  turmas.forEach(t => selTurma.add(new Option(t,t)));
  eixos.forEach(e => selEixo.add(new Option(e,e)));
  months.forEach(m => selMonth.add(new Option(m,m)));
}

// aplica filtros a um array de linhas
function applyFilters(rows) {
  if (!rows) return [];
  const turma = q("sel-turma").value;
  const eixo  = q("sel-eixo").value;
  const month = q("sel-month").value;
  return rows.filter(r => {
    if (turma !== "Todos" && (r["Turma"]||"") !== turma) return false;
    if (eixo  !== "Todos" && (r["Eixo"]||"") !== eixo) return false;
    // Timestamp ou Carimbo de data/hora
    const ts = r["Timestamp"] || r["Carimbo de data/hora"] || "";
    if (month !== "Todos" && ts !== month) return false;
    return true;
  });
}

// conta respostas por emoji para uma dada pergunta (combina checkin + checkout)
function countByEmoji(combinedRows, questionKey) {
  const counts = OPTION_EMOJIS.map(() => 0);
  (combinedRows || []).forEach(row => {
    const raw = (row[questionKey] || "").toString().trim();
    if (!raw) return;
    // checar qual emoji inicia a string (pode haver ou não espaço após emoji)
    for (let i=0;i<OPTION_EMOJIS.length;i++) {
      const em = OPTION_EMOJIS[i].emoji;
      if (raw.startsWith(em) || raw.startsWith(em + " ") ) {
        counts[i]++;
        return;
      }
    }
    // se não identificar, tentar detectar por presença do emoji em qualquer posição
    for (let i=0;i<OPTION_EMOJIS.length;i++) {
      const em = OPTION_EMOJIS[i].emoji;
      if (raw.indexOf(em) >= 0) { counts[i]++; return; }
    }
  });
  return counts;
}

// constroi o chart empilhado
function buildCompareChart(labels, datasetsData) {
  const ctx = q("chart-compare").getContext("2d");
  if (state.chart) state.chart.destroy();

  state.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: datasetsData.map(d => ({
        label: d.label,
        data: d.data,
        backgroundColor: d.bg
      }))
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false }, // vamos renderizar legenda customizada
        tooltip: { enabled: true }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { precision:0 } }
      }
    }
  });

  // renderiza legenda customizada
  renderLegendCompare(datasetsData);
}

function renderLegendCompare(datasetsData) {
  const el = q("legend-compare");
  if (!el) return;
  el.innerHTML = "";
  datasetsData.forEach(d => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = "legend-swatch";
    sw.style.background = d.bg;
    const text = document.createElement("span");
    text.textContent = d.label;
    item.appendChild(sw);
    item.appendChild(text);
    el.appendChild(item);
  });
}

// calcula média de uma chave numérica em rows
function asNumber(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const s = v.toString().trim().replace(",",".");
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}
function calcAverage(rows, key) {
  const vals = (rows||[]).map(r => asNumber(r[key])).filter(n => !isNaN(n));
  if (!vals.length) return null;
  const sum = vals.reduce((a,b)=>a+b,0);
  return sum / vals.length;
}

// formata resumo IA: converte '###' em <strong>, mantem parágrafos e emojis
function formatAISummary(rawText) {
  if (!rawText) return "Sem conteúdo da IA.";
  let s = rawText.replace(/—/g, "-").replace(/\r/g, "");
  const blocks = s.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const htmlBlocks = blocks.map(block => {
    const headingMatch = block.match(/^#{1,6}\s*(.+)$/m);
    if (headingMatch) {
      const title = headingMatch[1].trim();
      const rest = block.replace(/^#{1,6}\s*.+\n?/, "").trim();
      const paras = rest.split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join("");
      return `<p><strong>${escapeHtml(title)}</strong></p>${paras}`;
    } else {
      const paras = block.split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join("");
      return paras;
    }
  });
  return htmlBlocks.join("<br/>");
}
function escapeHtml(text) {
  return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// encurta label do eixo x sem cortar palavras
function shorten(s, max=60) {
  if (!s) return s;
  if (s.length <= max) return s;
  const cut = s.slice(0,max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 10 ? cut.slice(0,lastSpace) : cut) + '...';
}

// render principal: busca, popula filtros, aplica filtros, atualiza chart e NPS
async function renderAll() {
  const data = await fetchExec();
  if (!data) return;
  const raw = data.raw || {};
  state.raw = raw;

  setText("last-update", "Última: " + new Date().toLocaleString());

  populateFilters(raw);

  // aplicar filtros
  const checkinFiltered = applyFilters(raw.checkin || []);
  const checkoutFiltered = applyFilters(raw.checkout || []);
  const avaliacaoFiltered = applyFilters(raw.avaliacao || []);

  // combinar checkin+checkout
  const combined = checkinFiltered.concat(checkoutFiltered);

  // para cada pergunta, obter contagens por emoji
  const labels = QUESTIONS.map(q => shorten(q, 60));
  const allDatasets = OPTION_EMOJIS.map((opt, idx) => {
    // para cada pergunta, obter count
    const dataPerQuestion = QUESTIONS.map(qk => {
      const counts = countByEmoji(combined, qk);
      return counts[idx] || 0;
    });
    const color = idx === 0 ? 'rgba(220,53,69,0.9)' : (idx === 1 ? 'rgba(255,159,64,0.9)' : (idx === 2 ? 'rgba(255,205,86,0.9)' : 'rgba(75,192,192,0.9)'));
    // label curto (emoji + palavra)
    const label = `${opt.emoji} ${opt.short.replace(/^.+?\s/, '')}`; // keep short tail
    return { label: `${opt.emoji} ${opt.short}`, data: dataPerQuestion, bg: color };
  });

  buildCompareChart(labels, allDatasets);

  // calcular NPS / médias (avaliacao)
  const avgRec = calcAverage(avaliacaoFiltered, KEY_REC);
  const avgAuto = calcAverage(avaliacaoFiltered, KEY_AUTO);
  const avgProf = calcAverage(avaliacaoFiltered, KEY_PROF);

  setText("metric-nps-rec", avgRec === null ? "—" : avgRec.toFixed(2));
  setText("metric-nps-auto", avgAuto === null ? "—" : avgAuto.toFixed(2));
  setText("metric-nps-prof", avgProf === null ? "—" : avgProf.toFixed(2));

  // se o backend retornou ai, mostrar, senão manter botão para gerar
  if (data.ai) {
    setHTML("ai-summary", formatAISummary(data.ai.resumo || data.ai.text || JSON.stringify(data.ai)));
  } else {
    setText("ai-summary", "Clique em 'Gerar Insights IA' para solicitar um resumo.");
  }
}

// CONTROLE de insights (chama o Apps Script com action=insights)
async function fetchInsights() {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: Date.now() });
    const turma = q("sel-turma").value; if (turma !== "Todos") params.set("turma", turma);
    const eixo  = q("sel-eixo").value;  if (eixo !== "Todos")  params.set("eixo", eixo);
    const month = q("sel-month").value; if (month !== "Todos") params.set("month", month);
    const url = APPSCRIPT_URL + "?" + params.toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    const json = await res.json();
    if (json.ai) {
      setHTML("ai-summary", formatAISummary(json.ai.resumo || json.ai.text || JSON.stringify(json.ai)));
    } else if (json.text) {
      setHTML("ai-summary", formatAISummary(json.text));
    } else {
      setText("ai-summary", "Nenhum insight retornado.");
    }
  } catch (err) {
    console.error("Erro fetchInsights:", err);
    alert("Erro ao gerar insights: " + err.message);
  }
}

// eventos: filtros e botões
["sel-turma","sel-eixo","sel-month"].forEach(id => {
  q(id).addEventListener("change", () => renderAll());
});
q("btn-refresh").addEventListener("click", () => renderAll());
q("btn-insights").addEventListener("click", () => fetchInsights());

// inicializa
renderAll();
setInterval(() => renderAll(), AUTO_REFRESH_SECONDS * 1000);
