// ===================== CONFIG =====================
// ESTA URL DEVE SER SUBSTITUÍDA PELA URL DE EXECUÇÃO DO SEU GOOGLE APPSCRIPT
const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec";
const AUTO_REFRESH_SECONDS = 90; // Intervalo de polling para buscar novos dados do AppScript
// ===================================================

let state = { raw: null, processed: null };

// --------------- Fetch / Helpers ---------------
/**
 * Busca dados do Google App Script.
 * @param {boolean} ignoreCache Força o refresh dos dados do AppScript/Google Sheets.
 * @returns {Promise<Object|null>} Os dados brutos e processados.
 */
async function fetchExec(ignoreCache = false) {
  try {
    const params = new URLSearchParams();
    // Adiciona um timestamp para evitar cache do navegador se ignoreCache for true
    if (ignoreCache) params.set("_ts", String(Date.now()));
    const url = APPSCRIPT_URL + (params.toString() ? "?" + params.toString() : "");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error("fetchExec error:", err);
    // Substituindo alert() por log no console, conforme a instrução.
    console.error("Erro ao buscar dados: " + err.message);
    return null;
  }
}

/**
 * Busca insights da IA, passando os filtros atuais.
 * @param {Object} filters Filtros selecionados (turma, eixo).
 * @returns {Promise<Object|null>} O objeto de resposta da IA.
 */
async function fetchInsights(filters = {}) {
  try {
    const params = new URLSearchParams({ action: "insights", _ts: String(Date.now()) });
    if (filters.turma) params.set("turma", filters.turma);
    if (filters.eixo)  params.set("eixo", filters.eixo);
    const url = APPSCRIPT_URL + "?" + params.toString();
    
    // Indica que estamos buscando o insight da IA
    q("ai-summary").innerHTML = "<em>Gerando insights com inteligência artificial... aguarde...</em>";

    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error("fetchInsights error:", err);
    return null;
  }
}

function q(id){ return document.getElementById(id); }

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
/**
 * Popula os dropdowns de filtro (Turma, Eixo) com base nos dados brutos.
 * @param {Object} data Dados brutos e processados.
 */
function populateFilters(data) {
  const checkin = data.raw.checkin || [];
  const checkout = data.raw.checkout || [];
  const avaliacao = data.raw.avaliacao || [];
  const merged = checkin.concat(checkout).concat(avaliacao);

  // Filtro de Mês/Ano foi removido aqui
  const turmas = Array.from(new Set(merged.map(r => r["Turma"]).filter(Boolean))).sort();
  const eixos  = Array.from(new Set(merged.map(r => r["Eixo"]).filter(Boolean))).sort();

  const selTurma = q("sel-turma");
  const selEixo  = q("sel-eixo");

  [selTurma, selEixo].forEach(el => {
    if (!el) return;
    
    // Armazena o valor atual para tentar restaurar
    const currentVal = el.value;
    
    // Limpa todas as opções, exceto a primeira ("Todos")
    while(el.options.length > 1) el.remove(1);
    
    // Repopula
    if(el === selTurma) turmas.forEach(t => el.add(new Option(t, t)));
    if(el === selEixo)  eixos.forEach(e => el.add(new Option(e, e)));

    // Tenta restaurar valor se ainda existir
    if (currentVal && Array.from(el.options).some(o => o.value === currentVal)) {
       el.value = currentVal;
    } else {
       // Se o valor sumiu com a nova carga de dados, volta para "Todos"
       el.value = "Todos";
    }
  });
}

/**
 * Aplica os filtros selecionados a um array de linhas de dados.
 * @param {Array<Object>} rows Array de linhas de dados.
 * @returns {Array<Object>} Linhas filtradas.
 */
function applyFiltersToRows(rows) {
  const turmaEl = q("sel-turma");
  const eixoEl  = q("sel-eixo");

  const turma = turmaEl ? turmaEl.value : "Todos";
  const eixo  = eixoEl  ? eixoEl.value  : "Todos";

  return (rows||[]).filter(r => {
    // Filtro por Turma
    if (turma && turma !== "Todos" && (r["Turma"]||"") !== turma) return false;
    // Filtro por Eixo
    if (eixo  && eixo !== "Todos" && (r["Eixo"]||"") !== eixo) return false;
    return true;
  });
}

// ---------------- Count / Percent helpers ----------------
function countCategory(rows, questionFull, categoryEmoji) {
  let cnt = 0;
  (rows||[]).forEach(r => {
    const v = (r[questionFull] || "").toString();
    if (!v) return;
    // Verifica se a string da resposta contém o emoji da categoria
    if (v.indexOf(categoryEmoji) !== -1) cnt++;
  });
  return cnt;
}

/**
 * Constrói o objeto de contagens e percentuais por categoria/pergunta.
 * @param {Array<Object>} rows Linhas de check-in/out filtradas.
 * @returns {Object} Objeto de contagens e percentuais.
 */
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
/**
 * Renderiza a tabela de Check-in ou Check-out.
 * @param {string} containerId ID do elemento onde a tabela será inserida.
 * @param {Object} tableObj Objeto com as contagens e percentuais.
 */
function renderCountsTable(containerId, tableObj) {
  const container = q(containerId);
  if (!container) return;
  
  container.innerHTML = "";
  if (Object.keys(tableObj).length === 0 || tableObj[Object.keys(tableObj)[0]].total === 0) {
    container.innerHTML = `<div style="padding: 1rem; text-align: center; color: #888;">Sem dados para os filtros selecionados.</div>`;
    return;
  }
  
  const table = document.createElement("table");

  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  // Ordem das colunas: Pergunta, Qtd/%, Qtd/%, ...
  const headers = ["Pergunta",
    "Qtd Ruim","% Ruim",
    "Qtd Regular","% Regular",
    "Qtd Bom","% Bom",
    "Qtd Ótimo","% Ótimo"];
  headers.forEach(h => { const th = document.createElement("th"); th.textContent = h; hrow.appendChild(th); });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  Object.keys(tableObj).forEach(short => {
    const d = tableObj[short];
    const tr = document.createElement("tr");

    const tdQ = document.createElement("td"); 
    tdQ.textContent = short; 
    tr.appendChild(tdQ);

    // Ordem das colunas: Ruim, Regular, Bom, Ótimo
    const keysOrder = ["Ruim", "Regular", "Bom", "Ótimo"];

    keysOrder.forEach(k => {
      const tdQtd = document.createElement("td"); tdQtd.textContent = d.counts[k] || 0; tr.appendChild(tdQtd);
      const tdPct = document.createElement("td"); tdPct.textContent = formatPct(d.perc[k] || 0); tr.appendChild(tdPct);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

/**
 * Calcula a diferença percentual (CO % - CI %) para a tabela de resultados.
 * @param {Object} checkinObj Objeto de contagens/percentuais do check-in.
 * @param {Object} checkoutObj Objeto de contagens/percentuais do check-out.
 * @returns {Object} Objeto de resultados.
 */
function buildResultTable(checkinObj, checkoutObj) {
  const out = {};
  Object.keys(QUESTIONS).forEach(short => {
    out[short] = {};
    CATEGORIES.forEach(cat => {
      const ci = (checkinObj[short] && checkinObj[short].perc[cat.key]) || 0;
      const co = (checkoutObj[short] && checkoutObj[short].perc[cat.key]) || 0;
      out[short][cat.key] = co - ci; // Diferença CO - CI
    });
  });
  return out;
}

/**
 * Renderiza a tabela de Resultado Final.
 * @param {string} containerId ID do elemento onde a tabela será inserida.
 * @param {Object} resultObj Objeto com as diferenças percentuais.
 */
function renderResultTable(containerId, resultObj) {
  const container = q(containerId);
  if (!container) return;
  container.innerHTML = "";

  // Verifica se há dados suficientes para pelo menos uma das tabelas de origem
  const hasData = Object.keys(resultObj).some(short => 
    Object.keys(resultObj[short]).some(cat => resultObj[short][cat] !== undefined)
  );

  if (!hasData) {
    container.innerHTML = `<div style="padding: 1rem; text-align: center; color: #888;">Sem dados suficientes para calcular o resultado.</div>`;
    return;
  }
  
  const table = document.createElement("table");

  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  // Colunas do resultado: Pergunta, Ruim, Regular, Bom, Ótimo (diferença CO-CI)
  const headers = ["Pergunta", "% Ruim", "% Regular", "% Bom", "% Ótimo"]; 
  headers.forEach(h => { const th = document.createElement("th"); th.textContent = h; hrow.appendChild(th); });
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  Object.keys(resultObj).forEach(short => {
    const d = resultObj[short];
    const tr = document.createElement("tr");
    const tdQ = document.createElement("td"); 
    tdQ.textContent = short; 
    tr.appendChild(tdQ);

    // Ordem das colunas: Ruim, Regular, Bom, Ótimo
    const keysOrder = ["Ruim", "Regular", "Bom", "Ótimo"]; 
    keysOrder.forEach(k => {
      const val = d[k] || 0;
      const td = document.createElement("td");
      
      const sign = val > 0 ? "+" : "";
      const formatted = sign + (Math.round(val * 100) / 100).toFixed(1) + "%";
      td.textContent = formatted;
      
      // Aplicando a coloração:
      
      // Detratores (Ruim)
      if (k === "Ruim") { 
        // Se a % Ruim diminuiu (valor negativo), é positivo!
        if (val < 0) td.className = "positive";
        // Se a % Ruim aumentou (valor positivo), é negativo!
        else if (val > 0) td.className = "negative";
      } 
      // Promotores (Bom, Ótimo)
      else if (k === "Bom" || k === "Ótimo") {
        // Se a % Bom/Ótimo aumentou (valor positivo), é positivo!
        if (val > 0) td.className = "positive";
        // Se a % Bom/Ótimo diminuiu (valor negativo), é negativo!
        else if (val < 0) td.className = "negative";
      }
      // Regular
      else if (k === "Regular") {
        // Aumento (CO > CI) é classificado como 'positive' (melhora)
        if (val > 0) td.className = "positive";
        // Diminuição (CO < CI) é classificado como 'negative' (piora)
        else if (val < 0) td.className = "negative";
      }

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
    // Prioriza NPS/Recomendação
    if (!rec && (kn.includes("recomen") || kn.includes("nps"))) rec = k; 
    // Prioriza Autoavaliação (1-5)
    else if (!auto && (kn.includes("autoavalia"))) auto = k;
    // Pega todos os professores
    else if (kn.includes("professor") || kn.includes("prof ")) {
      profs.push(k);
    }
  });
  
  return { recKey: rec, autoKey: auto, profKeys: profs.slice(0, 2) }; // Limita a 2 profs no display
}

// ---------------- NPS / Averages ----------------
function computeNPS(avRows, recKey) {
  if (!recKey) return { nps: null, promPct: 0, detrPct: 0, total: 0 };
  const numeric = avRows.map(r => Number(r[recKey])).filter(v => !isNaN(v) && v >= 0 && v <= 10);
  if (!numeric.length) return { nps: null, promPct: 0, detrPct: 0, total: 0 };
  const total = numeric.length;
  const prom = numeric.filter(v => v >= 9).length; // Promotores: 9 ou 10
  const detr = numeric.filter(v => v <= 6).length; // Detratores: 0 a 6
  // Neutros: 7 ou 8 (não usados no cálculo)
  const nps = Math.round((prom/total*100) - (detr/total*100));
  return { nps, promPct: prom/total*100, detrPct: detr/total*100, total };
}

function averageNumeric(rows, key) {
  if (!key) return null;
  const nums = rows.map(r => Number(r[key])).filter(v => !isNaN(v));
  if (!nums.length) return null;
  return nums.reduce((a,b)=>a+b,0)/nums.length;
}

// ---------------- RICH TEXT FORMATTER (Markdown-ish) ----------------
/**
 * Converte um texto simples com sintaxe Markdown-ish (###, **, -) em HTML formatado.
 * Implementa Rich Text para o resumo da IA.
 * @param {string} text Texto de entrada da IA.
 * @returns {string} HTML formatado.
 */
function formatRichText(text) {
  if (!text) return "";
  
  let html = text;
  
  // 1. Headers (### Título) - Mantém a tag H3 para o CSS estilizar
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  
  // 2. Bold (**Texto**)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // 3. Lists (- Item) - Converte itens de lista em <li> e envolve em <ul>
  
  // Primeiro, transforma linhas que começam com '-' ou 'número. ' em <li>
  const listRegex = /^[\-]\s+(.*$)|^(\d+\.\s+)(.*$)/gim;
  html = html.replace(listRegex, (match, p1, p2, p3) => {
    const content = p1 || p3; // Conteúdo da lista
    return `<li>${content}</li>`;
  });

  // Em seguida, envolve blocos de <li> em <ul> (simples)
  // O 'gs' permite o match em múltiplas linhas e de forma não gulosa
  html = html.replace(/((?:<li>.*?<\/li>[\s]*)+)/gs, '<ul>$1</ul>');
  
  // 4. Quebras de linha (parágrafos)
  // Remove quebras de linha que sobraram após fechamentos de tags de bloco para evitar espaçamento duplo
  html = html.replace(/<\/h3>[\s]*<br>/g, '</h3>');
  html = html.replace(/<\/ul>[\s]*<br>/g, '</ul>');
  
  // Substitui quebras de linha simples por <br> (para simular parágrafos)
  html = html.replace(/\n/g, '<br>');

  return html;
}

// ---------------- INSIGHTS RENDERING ----------------
function renderInsightsText(aiResponse) {
  const box = q("ai-summary");
  if (!box) return;
  if (!aiResponse || !aiResponse.text) {
    box.innerHTML = "<em>Nenhum insight disponível.</em>";
    return;
  }
  
  // Usa o formatador rico (Rich Text)
  box.innerHTML = formatRichText(aiResponse.text);
}

// ---------------- MAIN render ----------------
/**
 * Função principal para buscar e renderizar todos os dados no dashboard.
 * @param {boolean} ignoreCache Se for `true`, força a busca de novos dados do AppScript.
 */
async function renderAll(ignoreCache=false) {
  const lastUpdateEl = q("last-update");
  if(lastUpdateEl) lastUpdateEl.innerHTML = "🔄 Atualizando...";

  let data = state;
  let fetchedNewData = false;

  // Se for ignoreCache (botão Atualizar) ou se state.raw estiver vazio (primeira carga), busca da rede.
  if (ignoreCache || !state.raw) {
    const fetched = await fetchExec(ignoreCache);
    if (fetched) {
      state.raw = fetched.raw || {};
      state.processed = fetched.processed || {};
      data = state;
      // Popula ou repopula filtros após buscar dados novos
      populateFilters(data); 
      fetchedNewData = true;
    }
  }

  // Se não há dados, para a renderização
  if (!data.raw || (Object.keys(data.raw).length === 0 && !data.raw.checkin)) {
     if(lastUpdateEl) lastUpdateEl.innerHTML = "❌ Erro nos dados.";
     return;
  }

  // Atualiza timestamp da última atualização
  if(lastUpdateEl) {
    const now = new Date();
    lastUpdateEl.innerHTML = "🕐 " + now.getHours().toString().padStart(2,'0') + ":" + now.getMinutes().toString().padStart(2,'0');
  }

  // --- Aplica Filtros ---
  const checkinFiltered = applyFiltersToRows(data.raw.checkin || []);
  const checkoutFiltered = applyFiltersToRows(data.raw.checkout || []);
  const avaliacaoFiltered = applyFiltersToRows(data.raw.avaliacao || []);

  // --- 1. Tabelas ---
  const checkinTableObj = buildTableCounts(checkinFiltered);
  const checkoutTableObj = buildTableCounts(checkoutFiltered);
  renderCountsTable("table-checkin", checkinTableObj);
  renderCountsTable("table-checkout", checkoutTableObj);

  const resultObj = buildResultTable(checkinTableObj, checkoutTableObj);
  renderResultTable("table-result", resultObj);

  // --- 2. NPS & Averages ---
  const sample = data.raw.avaliacao && data.raw.avaliacao.length ? data.raw.avaliacao : [];
  const keys = findAvaliacaoKeys(sample);

  // NPS
  const npsObj = computeNPS(avaliacaoFiltered, keys.recKey);
  q("metric-nps-rec").textContent = (npsObj.nps !== null) ? String(npsObj.nps) : "—";
  q("nps-pct-prom").textContent = npsObj.promPct ? npsObj.promPct.toFixed(1) + "%" : "—";
  q("nps-pct-detr").textContent = npsObj.detrPct ? npsObj.detrPct.toFixed(1) + "%" : "—";

  // Autoavaliação
  const autoAvg = keys.autoKey ? averageNumeric(avaliacaoFiltered, keys.autoKey) : null;
  q("metric-nps-auto").textContent = autoAvg !== null ? Number(autoAvg).toFixed(2) : "—";

  // Professores
  const prof1Key = keys.profKeys && keys.profKeys.length > 0 ? keys.profKeys[0] : null;
  const prof2Key = keys.profKeys && keys.profKeys.length > 1 ? keys.profKeys[1] : null;
  const prof1Avg = prof1Key ? averageNumeric(avaliacaoFiltered, prof1Key) : null;
  const prof2Avg = prof2Key ? averageNumeric(avaliacaoFiltered, prof2Key) : null;

  q("metric-nps-prof1").textContent = prof1Avg !== null ? Number(prof1Avg).toFixed(2) : "—";
  q("metric-nps-prof2").textContent = prof2Avg !== null ? Number(prof2Avg).toFixed(2) : "—";

  // --- 3. Insights ---
  const aiBox = q("ai-summary");
  // Se buscou dados novos, ou se o filtro mudou, limpa o insight para que o usuário clique novamente
  if(fetchedNewData || !aiBox.textContent.includes("Clique em \"Gerar Insights IA\"")) {
    aiBox.innerHTML = 'Clique em "Gerar Insights IA" para obter uma análise detalhada dos dados da turma.';
  }
}

// ---------------- EVENTS ----------------
const btnRefresh = q("btn-refresh");
if(btnRefresh) btnRefresh.addEventListener("click", () => renderAll(true));

const btnInsights = q("btn-insights");
if(btnInsights) btnInsights.addEventListener("click", async () => {
  const box = q("ai-summary");
  if(box) box.innerHTML = "<em>Gerando insights com inteligência artificial... aguarde...</em>";

  // Captura os filtros atuais para enviar à IA
  const filters = {
    turma: q("sel-turma").value !== "Todos" ? q("sel-turma").value : null,
    eixo:  q("sel-eixo").value  !== "Todos" ? q("sel-eixo").value  : null
  };

  const resp = await fetchInsights(filters);
  
  if (!resp) {
      if(box) box.innerHTML = "❌ Erro ao buscar insights. Verifique a URL do AppScript ou se a ação 'insights' está configurada.";
      return;
  }
  
  if (resp.ai && resp.ai.text) {
    renderInsightsText(resp.ai);
  } else {
    // Fallback: mostra os dados brutos se a chamada falhar ou retornar sem texto
    const npsObj = computeNPS(applyFiltersToRows(state.raw.avaliacao || []), findAvaliacaoKeys(state.raw.avaliacao).recKey);
    const autoAvg = findAvaliacaoKeys(state.raw.avaliacao).autoKey ? averageNumeric(applyFiltersToRows(state.raw.avaliacao || []), findAvaliacaoKeys(state.raw.avaliacao).autoKey) : null;
    const prof1Key = findAvaliacaoKeys(state.raw.avaliacao).profKeys && findAvaliacaoKeys(state.raw.avaliacao).profKeys.length > 0 ? findAvaliacaoKeys(state.raw.avaliacao).profKeys[0] : null;
    const prof2Key = findAvaliacaoKeys(state.raw.avaliacao).profKeys && findAvaliacaoKeys(state.raw.avaliacao).profKeys.length > 1 ? findAvaliacaoKeys(state.raw.avaliacao).profKeys[1] : null;
    const prof1Avg = prof1Key ? averageNumeric(applyFiltersToRows(state.raw.avaliacao || []), prof1Key) : null;
    const prof2Avg = prof2Key ? averageNumeric(applyFiltersToRows(state.raw.avaliacao || []), prof2Key) : null;
    const resultObj = buildResultTable(buildTableCounts(applyFiltersToRows(state.raw.checkin || [])), buildTableCounts(applyFiltersToRows(state.raw.checkout || [])));
    
    const fallbackText = `
### Análise Rápida (Fallback Local)
- **NPS:** ${(npsObj.nps !== null) ? String(npsObj.nps) : '—'} (${npsObj.promPct ? npsObj.promPct.toFixed(1) + '%' : '—'} Promotores, ${npsObj.detrPct ? npsObj.detrPct.toFixed(1) + '%' : '—'} Detratores)
- **Autoavaliação Média:** ${autoAvg !== null ? Number(autoAvg).toFixed(2) : '—'}
- **Avanço no Eixo "${filters.eixo || 'Todos'}":**
- **Observação:** O serviço de IA para análise detalhada não respondeu. Verifique a configuração do Google AppScript e a permissão.
`;
    renderInsightsText({ text: fallbackText });
  }
});

// Ativando os filtros para atualizar automaticamente (Correção solicitada: renderAll(false))
["sel-turma", "sel-eixo"].forEach(id => {
    const el = q(id);
    if(el) {
        el.addEventListener("change", () => {
            // false = usa o cache local de dados (state.raw), apenas reaplica filtros e renderiza
            renderAll(false);
        });
    }
});

// initial render + polling
window.onload = function() {
  renderAll(true);
  // Inicia o polling para buscar novos dados do AppScript a cada 30 segundos
  setInterval(() => renderAll(true), AUTO_REFRESH_SECONDS * 1000); 
}
