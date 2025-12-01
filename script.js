// =============================
// CONFIG
// =============================

const APPSCRIPT_URL = "https://script.google.com/macros/s/AKfycbyosVBXuXDmpsMzqHNUcQ-Kjre15_lft_I5mswHVbyjSNHDx0LEkSgQejUYok8_WTM5/exec";

let cachedData = null;        // Mantém dados carregados
let cachedInsight = "";       // Mantém insight da IA entre atualizações
let autoRefreshInterval = null;

// Mapa de emojis → categorias numéricas
const emojiMap = {
    "😞": { label: "Ruim", score: 1 },
    "😬": { label: "Regular", score: 2 },
    "🙂": { label: "Bom", score: 3 },
    "😀": { label: "Ótimo", score: 4 }
};

// Perguntas fixas
const QUESTIONS = [
    "Hoje você consegue reconhecer situações que te desestabilizam e exigem maior autocontrole?",
    "Hoje é “de boa” nomear, com clareza, as emoções que você está sentindo?",
    "Você consegue reconhecer características de um comportamento autoconfiante?",
    "Hoje, como é o seu relacionamento com as pessoas e sua capacidade de trabalhar em equipe?"
];

// =============================
// CHAMADA À API
// =============================
async function loadData() {
    try {
        const response = await fetch(APPSCRIPT_URL);
        const json = await response.json();
        cachedData = json;
        renderDashboard();
    } catch (err) {
        console.error("Erro ao carregar dados:", err);
    }
}

// =============================
// PROCESSAMENTO CHECKIN / CHECKOUT
// =============================
function extractEmoji(text) {
    if (!text) return null;
    const match = Object.keys(emojiMap).find(e => text.includes(e));
    return match || null;
}

function summarizeScaleData(data) {
    const result = {};
    QUESTIONS.forEach(q => {
        result[q] = { Ruim: 0, Regular: 0, Bom: 0, Ótimo: 0 };
    });

    data.forEach(entry => {
        QUESTIONS.forEach(q => {
            const emoji = extractEmoji(entry[q]);
            if (emoji && emojiMap[emoji]) {
                const cat = emojiMap[emoji].label;
                result[q][cat]++;
            }
        });
    });

    return result;
}

// =============================
// NPS
// =============================
function calcNPS(values) {
    if (!values || values.length === 0) return 0;

    const detratores = values.filter(v => v >= 0 && v <= 6).length;
    const neutros = values.filter(v => v === 7 || v === 8).length;
    const promotores = values.filter(v => v === 9 || v === 10).length;
    const total = values.length;

    const pctDet = (detratores / total) * 100;
    const pctPro = (promotores / total) * 100;

    return Math.round(pctPro - pctDet);
}

// =============================
// RENDER DO DASHBOARD
// =============================
function renderDashboard() {
    if (!cachedData) return;

    // Processamento checkin/checkout
    const checkin = cachedData.raw.checkin || [];
    const checkout = cachedData.raw.checkout || [];

    const sumCheckin = summarizeScaleData(checkin);
    const sumCheckout = summarizeScaleData(checkout);

    renderCharts(sumCheckin, sumCheckout);
    renderAvaliacao(cachedData.raw.avaliacao || []);

    // Restaura insight salvo
    if (cachedInsight) {
        document.getElementById("insightBox").innerHTML = cachedInsight;
    }
}

// =============================
// GRÁFICOS
// =============================
function renderCharts(checkin, checkout) {
    QUESTIONS.forEach((q, index) => {
        const container = document.getElementById(`chart-q${index + 1}`);
        if (!container) return;

        const labels = ["Ruim", "Regular", "Bom", "Ótimo"];

        const dataCheckin = labels.map(l => checkin[q][l]);
        const dataCheckout = labels.map(l => checkout[q][l]);

        new Chart(container, {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: "Check-in",
                        data: dataCheckin
                    },
                    {
                        label: "Check-out",
                        data: dataCheckout
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: true },
                    datalabels: {
                        anchor: "center",
                        align: "center",
                        formatter: v => (v > 0 ? v : "")
                    }
                },
                scales: { y: { beginAtZero: true } }
            }
        });
    });
}

// =============================
// RENDER AVALIAÇÃO
// =============================
function renderAvaliacao(avaliacao) {
    if (!avaliacao || avaliacao.length === 0) return;

    const prof1 = avaliacao.map(a => Number(a["Em uma escala de 1 a 5, como você avalia o professor 1 na condução das aulas deste módulo?"])).filter(v => v > 0);
    const prof2 = avaliacao.map(a => Number(a["Em uma escala de 1 a 5, como você avalia o professor 2 na condução das aulas deste módulo?"])).filter(v => v > 0);
    const rec = avaliacao.map(a => Number(a["Em uma escala de 0 a 10 o quanto você recomendaria o eixo de Inteligência Emocional a um colega?"])).filter(v => v >= 0);

    const avg1 = (prof1.reduce((a,b)=>a+b,0) / prof1.length).toFixed(1);
    const avg2 = (prof2.reduce((a,b)=>a+b,0) / prof2.length).toFixed(1);
    const nps = calcNPS(rec);

    document.getElementById("prof1Media").innerText = avg1;
    document.getElementById("prof2Media").innerText = avg2;
    document.getElementById("npsValue").innerText = nps;
}

// =============================
// INSIGHT IA
// =============================
async function gerarInsight() {
    const openText = cachedData.raw.avaliacao.map(a => ({
        bom: a["Que bom (O que você gostou)"],
        tal: a["Que tal (O que poderia ser melhor)"],
        pena: a["Que pena (O que você não gostou)"]
    }));

    const prompt = `
Gere um resumo curto e objetivo, com emojis e separação por linhas, sobre:
- "Que bom": o que os alunos gostaram
- "Que tal": o que pode melhorar
- "Que pena": o que não gostaram
Texto simples, sem travessão, sem formalidade.
Dados: ${JSON.stringify(openText)}
    `;

    const result = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }]
        })
    }).then(r => r.json());

    cachedInsight = result.choices[0].message.content;
    document.getElementById("insightBox").innerHTML = cachedInsight;
}

// =============================
// ATUALIZAÇÃO AUTOMÁTICA SEM APAGAR IA
// =============================
function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);

    autoRefreshInterval = setInterval(() => {
        loadData(); // mantém o insight existente
    }, 45000);
}

// =============================
// INIT
// =============================
window.onload = () => {
    loadData();
    startAutoRefresh();
};
