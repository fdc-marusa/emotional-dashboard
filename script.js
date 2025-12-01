// ===================== CONFIG - coloque aqui seu URL do Apps Script =====================
const APPSCRIPT_URL = "https://script.google.com/macros/s/SEU_ENDPOINT_AQUI/exec"; // <<-- substitua
const AUTO_REFRESH_SECONDS = 45; // quando quiser mudar auto-refresh
// =======================================================================================

let state = { raw: null, chart: null };

// perguntas que queremos exibir (textos exatos — ajuste se os textos na sua planilha diferirem)
const QUESTIONS = [
  "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
  "Hoje é de boa nomear, com clareza, as emoções que você está sentindo?",
  "Você consegue reconhecer características de um comportamento autoconfiante?",
  "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];

// as três opções (texto exato esperado nas respostas). Se na sua planilha o texto for diferente,
// ajuste as strings aqui para bater exatamente.
const OPTION_LABELS = [
  { key: "opa1", emoji: "🙂", text: "Quase sempre, reconheço situações que me desestabilizam, mas posso melhorar o autocontrole." },
  { key: "opa2", emoji: "😬", text: "Mais ou menos, reconheço situações que me desestabilizam, mas tenho dificuldade em manter o autocontrole." },
  { key: "opa3", emoji: "😀", text: "Consigo! Reconheço as situações que me desestabilizam e respondo bem as que exigem bastante autocontrole." }
];

// chaves das três perguntas NPS na aba "avaliacao" (ajuste caso seus cabeçalhos sejam diferentes)
const KEY_REC = "Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?";
const KEY_AUTO = "Em uma escala de 1 a 5, como você se autoavalia em relação ao seu desempenho nas aulas deste módulo?";
const KEY_PROF = "Em uma escala de 1 a 5, como você avalia o professor Fernando Oliveira na condução das aulas deste módulo?";

// helpers DOM
const q = id => document.getElementById(id);
const setText = (id, txt) => { const el = q(id); if (el) el.textContent = txt; };
const setHTML = (id, html) => { const el = q(id); if (el) el.innerHTML = html; };

// fetch dos dados
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

// popula selects com opções únicas retiradas dos dados
function populateFilters(raw) {
  const combine = (raw.checkin||[]).concat(raw.checkout||[]).concat(raw.avaliacao||[]);
  const turmas = Array.from(new Set(combine.map(r => r["Turma"]).filter(Boolean))).sort();
  const eixos  = Array.from(new Set(combine.map(r => r["Eixo"]).filter(Boolean))).sort();
  const months = Array.from(new Set(combine.map(r => r["Timestamp"]).filter(Boolean))).sort();

  const selTurma = q("sel-turma");
  const selEixo  = q("sel-eixo");
  const selMonth = q("sel-month");

  // limpa opções existentes (mantém a opção 0 = Todos)
  [selTurma, selEixo, selMonth].forEach(sel => {
    while (sel.options.length > 1) sel.remove(1);
  });

  turmas.forEach(t => selTurma.add(new Option(t, t)));
  eixos.forEach(e => selEixo.add(new Option(e, e)));
  months.forEach(m => selMonth.add(new Option(m, m)));
}

// aplica filtros a uma lista de linhas (objetos). Se "Todos", não filtra o campo.
function applyFilters(rows) {
  if (!rows) return [];
  const turma = q("sel-turma").value;
  const eixo  = q("sel-eixo").value;
  const month = q("sel-month").value;
  return rows.filter(r => {
    if (turma !== "Todos" && (r["Turma"]||"") !== turma) return false;
    if (eixo  !== "Todos" && (r["Eixo"]||"") !== eixo) return false;
    if (month !== "Todos" && (r["Timestamp"]||"") !== month) return false;
    return true;
  });
}

// transforma valor em número (quando possível)
function asNumber(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const s = v.toString().trim().replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}

// calcula média simples de uma coluna (array de linhas) considerando apenas números válidos
function calcAverage(rows, key) {
  const nums = (rows||[]).map(r => asNumber(r[key])).filter(n => !isNaN(n));
  if (!nums.length) return null;
  const sum = nums.reduce((a,b)=>a+b,0);
  return sum / nums.length;
}

// conta quantas respostas por pergunta/option (procura match exato do texto da alternativa)
// nós vamos olhar em BOTH checkin e checkout para as perguntas (combinar)
function countOptionsForQuestion(filteredCombined, questionText, optionTexts) {
  // optionTexts: array de strings a comparar (aqui usamos os textos em OPTION_LABELS[*].text)
  const counts = optionTexts.map(_ => 0);
  (filteredCombined || []).forEach(row => {
    const v = (row[questionText] || "").toString().trim();
    optionTexts.forEach((opt, i) => {
      // comparação exata: se bate -> conta
      if (v === opt) counts[i] = counts[i] + 1;
    });
  });
  return counts;
}

// constrói o gráfico de barras empilhadas (comparação)
function buildCompareChart(labels, datasetsData) {
  const ctx = q("chart-compare").getContext("2d");
  if (state.chart) state.chart.destroy();

  // datasetsData: array de { label, data, bg } (um por opção)
  state.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: datasetsData.map(d => ({
        label: d.label, // já formatado com emoji + texto curto
        data: d.data,
        backgroundColor: d.bg
      }))
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth:14, boxHeight:14 } },
        tooltip: { enabled: true }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { precision:0 } }
      }
    }
  });
}

// recebe texto livre da IA (possivelmente com markdown) e formata para HTML conforme solicitado:
// - títulos (linhas que começam com '###') viram <strong> títulos, com quebra
// - quebras de linhas mantidas como <p>
// - linguagem leve: apenas formatação (o texto já vem do backend). Substitui travessões por '-' simples (remove travessões longos).
// - garante que cada insight esteja em uma linha/parágrafo separada
function formatAISummary(rawText) {
  if (!rawText) return "Sem conteúdo da IA.";

  // remover travessões longos e substituir por '-'
  let s = rawText.replace(/—/g, "-").replace(/\r/g, "");

  // se tem cabeçalhos "###", vamos separar por esses blocos
  // dividimos por linhas em branco duplas para identificar parágrafos
  const blocks = s.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const htmlBlocks = blocks.map(block => {
    // se o bloco começa com ###, pega o título
    const headingMatch = block.match(/^#{1,6}\s*(.+)$/m);
    if (headingMatch) {
      // pega conteúdo sem a linha de heading
      const title = headingMatch[1].trim();
      const rest = block.replace(/^#{1,6}\s*.+\n?/, "").trim();
      // transforma linhas do rest em <p> separados por quebra simples
      const paras = rest.split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join("");
      return `<p><strong>${escapeHtml(title)}</strong></p>${paras}`;
    } else {
      // sem heading: só quebra em parágrafos
      const paras = block.split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join("");
      return paras;
    }
  });

  // juntar e permitir que haja emojis e quebras entre insights
  return htmlBlocks.join("<br/>");
}

// evita injeção: escapa HTML simples (mas permite emojis)
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ==== MAIN RENDER FUNC (busca dados, popula filtros, atualiza gráfico e NPS) ====
async function renderAll(ignoreCache=false) {
  const data = await fetchExec();
  if (!data) return;

  // esperamos que data.raw exista com campos checkin, checkout, avaliacao (array de objetos)
  const raw = data.raw || {};
  state.raw = raw;

  // atualiza texto última atualização
  setText("last-update", "Última: " + new Date().toLocaleString());

  // popula filtros (turma/eixo/month)
  populateFilters(raw);

  // aplicar filtros: cada array será filtrado
  const checkinFiltered = applyFilters(raw.checkin || []);
  const checkoutFiltered = applyFilters(raw.checkout || []);
  const avaliacaoFiltered = applyFilters(raw.avaliacao || []);

  // combinar checkin + checkout para as perguntas (já filtrado)
  const combinedQ = checkinFiltered.concat(checkoutFiltered);

  // construir datasets para o gráfico: para cada OPTION, crio array de counts por pergunta
  const optionTexts = OPTION_LABELS.map(o => o.text);
  const datasetsData = OPTION_LABELS.map((opt, idx) => {
    const dataPerQuestion = QUESTIONS.map(qText => {
      const counts = countOptionsForQuestion(combinedQ, qText, optionTexts);
      return counts[idx] || 0;
    });
    // cores (escolha simples)
    const bg = idx === 0 ? 'rgba(101,38,109,0.85)' : (idx === 1 ? 'rgba(255,131,79,0.85)' : 'rgba(76,175,80,0.85)');
    return { label: `${opt.emoji} — ${opt.text}`, data: dataPerQuestion, bg };
  });

  // labels: perguntas (curtas)
  const labels = QUESTIONS.map(q => shorten(q, 60));

  buildCompareChart(labels, datasetsData);

  // calcular NPS/médias a partir da aba "avaliacao"
  const avgRec = calcAverage(avaliacaoFiltered, KEY_REC);
  const avgAuto = calcAverage(avaliacaoFiltered, KEY_AUTO);
  const avgProf = calcAverage(avaliacaoFiltered, KEY_PROF);

  setText("metric-nps-rec", avgRec === null ? "—" : avgRec.toFixed(2));
  setText("metric-nps-auto", avgAuto === null ? "—" : avgAuto.toFixed(2));
  setText("metric-nps-prof", avgProf === null ? "—" : avgProf.toFixed(2));

  // se o backend já retornar algo para IA (p.ex. data.ai), formatamos e mostramos
  if (data.ai) {
    setHTML("ai-summary", formatAISummary(data.ai.resumo || data.ai.text || JSON.stringify(data.ai)));
  } else {
    setText("ai-summary", "Clique em 'Gerar Insights IA' para solicitar um resumo.");
  }
}

// encurta string para label do eixo x sem cortar palavras bruscas
function shorten(s, max) {
  if (!s) return s;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 10 ? cut.slice(0, lastSpace) : cut) + '...';
}

// REQUEST PARA INSIGHTS IA (chama o mesmo endpoint adicionando action=insights)
async function fetchInsights() {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: Date.now() });
    // enviar filtros
    const turma = q("sel-turma").value; if (turma !== "Todos") params.set("turma", turma);
    const eixo  = q("sel-eixo").value;  if (eixo !== "Todos")  params.set("eixo", eixo);
    const month = q("sel-month").value; if (month !== "Todos") params.set("month", month);

    const url = APPSCRIPT_URL + "?" + params.toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    const json = await res.json();
    // o backend deve retornar algo em json.ai (p.ex. { resumo: "...", queBom:[...], ... })
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

// EVENTOS: atualiza quando filtros mudam
["sel-turma","sel-eixo","sel-month"].forEach(id => {
  q(id).addEventListener("change", () => renderAll(true));
});

q("btn-refresh").addEventListener("click", () => renderAll(true));
q("btn-insights").addEventListener("click", () => fetchInsights());

// inicializa
renderAll(true);
setInterval(() => renderAll(true), AUTO_REFRESH_SECONDS * 1000);
