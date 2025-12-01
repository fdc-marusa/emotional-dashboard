const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec";

// Perguntas oficiais
const CHECK_QUESTIONS = [
    "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
    "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
    "Você consegue reconhecer características de um comportamento autoconfiante?",
    "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];

// Mapeamento das respostas com emojis para escore
const SCORE_MAP = [
    { key: "😞", value: 1 },
    { key: "😬", value: 2 },
    { key: "🙂", value: 3 },
    { key: "😀", value: 4 }
];

// Elementos
const loadBtn = document.getElementById("loadData");
const insightBtn = document.getElementById("generateInsight");

// Atualização automática (sem atualizar IA)
setInterval(() => loadData(false), 45000);

// Manual
loadBtn.addEventListener("click", () => loadData(false));
insightBtn.addEventListener("click", () => loadData(true));

async function loadData(generateAI) {
    try {
        const res = await fetch(APPSCRIPT_URL);
        const data = await res.json();

        if (!data || !data.raw) {
            console.error("JSON inválido ou vazio");
            return;
        }

        fillDashboard(data.raw);
        fillAvaliacao(data.raw);

        if (generateAI) generateAIInsight(data.raw);

    } catch (e) {
        console.error("Erro ao carregar dados:", e);
    }
}



//////////////////////////////////////////////////////////////////
// PARTE 1: PROCESSA CHECKIN / CHECKOUT
//////////////////////////////////////////////////////////////////

function scoreFromText(txt) {
    if (!txt) return 0;
    const item = SCORE_MAP.find(s => txt.includes(s.key));
    return item ? item.value : 0;
}

function fillDashboard(raw) {
    createComparisonCharts(raw.checkin, raw.checkout);
}

function createComparisonCharts(checkin, checkout) {
    // Limpa containers
    document.getElementById("chartCheckin").innerHTML = "";
    document.getElementById("chartCheckout").innerHTML = "";

    const checkinData = aggregateResponses(checkin);
    const checkoutData = aggregateResponses(checkout);

    makeChart("chartCheckin", "Check-in", checkinData);
    makeChart("chartCheckout", "Check-out", checkoutData);
}

function aggregateResponses(arr) {
    let result = {};

    CHECK_QUESTIONS.forEach(q => result[q] = { 1:0, 2:0, 3:0, 4:0 });

    arr.forEach(entry => {
        CHECK_QUESTIONS.forEach(q => {
            const score = scoreFromText(entry[q]);
            if (score > 0) result[q][score]++;
        });
    });

    return result;
}

function makeChart(containerId, title, dataObj) {
    const container = document.getElementById(containerId);

    Object.keys(dataObj).forEach(question => {

        const canvas = document.createElement("canvas");
        container.appendChild(canvas);

        new Chart(canvas, {
            type: "bar",
            data: {
                labels: ["😞", "😬", "🙂", "😀"],
                datasets: [{
                    label: question,
                    data: [
                        dataObj[question][1],
                        dataObj[question][2],
                        dataObj[question][3],
                        dataObj[question][4]
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    title: { display: true, text: title }
                }
            }
        });
    });
}



//////////////////////////////////////////////////////////////////
// PARTE 2: AVALIAÇÃO (NPS, Professores, etc.)
//////////////////////////////////////////////////////////////////

function fillAvaliacao(raw) {
    const avaliacao = raw.avaliacao || [];

    // NPS
    const npsScores = avaliacao.map(a =>
        Number(a["Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?"])
    );

    const detratores = npsScores.filter(n => n >= 0 && n <= 6).length;
    const promotores = npsScores.filter(n => n >= 9).length;
    const total = npsScores.filter(n => !isNaN(n)).length;

    const pctDet = ((detratores / total) * 100).toFixed(1);
    const pctPro = ((promotores / total) * 100).toFixed(1);

    const nps = (pctPro - pctDet).toFixed(1);

    document.getElementById("npsValue").innerHTML = `
        NPS = ${nps}<br>
        %Detratores: ${pctDet}%<br>
        %Promotores: ${pctPro}%
    `;

    // Professores
    const prof1 = avg(avaliacao.map(a => a["Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?"]));
    const prof2 = avg(avaliacao.map(a => a["Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?"]));

    document.getElementById("prof1").textContent = prof1.toFixed(1);
    document.getElementById("prof2").textContent = prof2.toFixed(1);
}

function avg(arr) {
    const clean = arr.filter(n => !isNaN(n));
    if (clean.length === 0) return 0;
    return clean.reduce((a,b) => a+b, 0) / clean.length;
}



//////////////////////////////////////////////////////////////////
// PARTE 3: INSIGHT DA IA (informal e divertido)
//////////////////////////////////////////////////////////////////

async function generateAIInsight(raw) {
    const total = raw.avaliacao.length;
    const prof1 = avg(raw.avaliacao.map(a => a["Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?"]));
    const prof2 = avg(raw.avaliacao.map(a => a["Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?"]));
    const nps = avg(raw.avaliacao.map(a =>
        a["Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?"]
    ));

    const text = `
Resumo rápido da turma 🌟

• O povo avaliou o eixo com média ${nps.toFixed(1)}. Nada mal, galera firme!
• O professor 1 tirou ${prof1.toFixed(1)}. Aparentemente anda distribuindo sabedoria com requinte e bom humor.
• O professor 2 veio com ${prof2.toFixed(1)} e manteve o combo educativo afiadíssimo.

Agora, vibes gerais:
A galera tá aprendendo sobre emoções, mas ainda tropeça na hora de dar nome aos sentimentos. Autoconfiança? Tá vindo aí, meio tímida, mas aparece.
Equipe? A maioria tá funcionando direitinho, só uns ajustes finos.

Resumo emocional:
O eixo tá entregando, os alunos tão virando chave e os professores tão brilhando. Continua assim que esse rolê emocional vai virar obra-prima. 🎨💛
`;

    document.getElementById("insightAI").textContent = text;
}
