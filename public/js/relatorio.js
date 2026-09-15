// Relatórios e gráficos

let relatoriosGerais = [];
let resumoServidor = null;
let chartBarra = null;
let chartPizza = null;
let periodoAtual = "atual"; // 'atual' ou 'todos'

function selecionarSecaoRelatorio(secao, ajustarRolagem = true) {
  const secaoAtiva = document.querySelector(`[data-relatorio-menu="${secao}"]`) ? secao : "resumo";

  document.querySelectorAll("[data-relatorio-secao]").forEach(elemento => {
    elemento.classList.toggle("active", elemento.dataset.relatorioSecao === secaoAtiva);
  });

  document.querySelectorAll("[data-relatorio-menu]").forEach(botao => {
    const ativo = botao.dataset.relatorioMenu === secaoAtiva;
    botao.classList.toggle("active", ativo);
    botao.setAttribute("aria-current", ativo ? "page" : "false");
  });

  const botaoAtivo = document.querySelector(`[data-relatorio-menu="${secaoAtiva}"] span`);
  const labelMobile = document.getElementById("relatorioMenuMobileLabel");
  if (labelMobile && botaoAtivo) labelMobile.textContent = botaoAtivo.textContent;

  fecharMenuRelatorioMobile();
  sessionStorage.setItem("secaoRelatorioAtiva", secaoAtiva);

  if (secaoAtiva === "graficos") {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      chartBarra?.resize();
      chartPizza?.resize();
    }));
  }

  if (ajustarRolagem && window.innerWidth <= 820) {
    document.querySelector(".relatorio-conteudo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function alternarMenuRelatorioMobile() {
  const sidebar = document.querySelector(".relatorio-sidebar");
  const botao = document.getElementById("btnMenuRelatorioMobile");
  if (!sidebar || !botao) return;
  const aberto = sidebar.classList.toggle("menu-aberto");
  botao.setAttribute("aria-expanded", String(aberto));
}

function fecharMenuRelatorioMobile() {
  document.querySelector(".relatorio-sidebar")?.classList.remove("menu-aberto");
  document.getElementById("btnMenuRelatorioMobile")?.setAttribute("aria-expanded", "false");
}

document.addEventListener("click", evento => {
  if (window.innerWidth <= 820 && !evento.target.closest(".relatorio-sidebar")) {
    fecharMenuRelatorioMobile();
  }
});

function mostrarToastRelatorio(msg) {
  const toast = document.getElementById("toastRelatorio");
  if (!toast) return;

  toast.innerText = msg;
  toast.classList.add("show");

  clearTimeout(window.toastRelatorioTimeout);
  window.toastRelatorioTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

// Trocar entre Mês Vigente e Histórico Completo
async function trocarPeriodoMes(valor) {
  periodoAtual = valor;
  sessionStorage.setItem("periodoRelatorio", valor);
  await carregarRelatoriosDoServidor();
}

// Alternar entre visualização de gráficos: Ambos, Barra, Pizza
function alternarVisualizacaoGraficos(modo) {
  const container = document.getElementById("containerGraficos");
  const btnAmbos = document.getElementById("btnVerAmbos");
  const btnBarra = document.getElementById("btnVerBarra");
  const btnPizza = document.getElementById("btnVerPizza");

  [btnAmbos, btnBarra, btnPizza].forEach(b => b && b.classList.remove("active"));

  container.classList.remove("modo-barra", "modo-pizza", "modo-ambos");
  container.classList.add(`modo-${modo}`);

  if (modo === "barra") {
    btnBarra.classList.add("active");
  } else if (modo === "pizza") {
    btnPizza.classList.add("active");
  } else {
    btnAmbos.classList.add("active");
  }

  // Aguarda o navegador concluir a nova grade antes de recalcular os canvases.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (chartBarra && modo !== "pizza") chartBarra.resize();
    if (chartPizza && modo !== "barra") chartPizza.resize();
  }));
}

// Carregar dados consolidados da API
async function carregarRelatoriosDoServidor() {
  try {
    const [resumo, locacoes, manutencoes] = await Promise.all([
      api.getResumoRelatorio(periodoAtual),
      api.getLocacoes(),
      api.getManutencoes()
    ]);

    resumoServidor = resumo;

    // Se o período for 'atual', filtra as listas locais para o mês atual
    const mesAlvo = resumo.periodo !== "Historico Completo" ? resumo.periodo : null;

    const listaNormalizada = [];

    locacoes.forEach(loc => {
      const mesLoc = (loc.dataInicio || "").slice(0, 7);
      if (mesAlvo && mesLoc !== mesAlvo) return; // ignora meses anteriores na exibição do mês

      listaNormalizada.push({
        id: loc.id,
        tipo: "locacao",
        data: loc.dataInicio,
        patinete: `${loc.patineteCodigo || `PAT${loc.patineteId}`} • ${loc.pontoNome || "Ponto"}`,
        cliente: loc.cliente,
        usuario: loc.usuarioOperador || "Operador",
        descricao: `Tempo: ${loc.tempoMinutos}m | Pag: ${loc.pagamento} ${loc.multa > 0 ? `(+R$ ${loc.multa.toFixed(2)} atraso)` : ""}`,
        valor: loc.valorTotal,
        status: loc.status
      });
    });

    manutencoes.forEach(m => {
      const mesMan = (m.data || "").slice(0, 7);
      if (mesAlvo && mesMan !== mesAlvo) return;

      listaNormalizada.push({
        id: m.id,
        tipo: "manutencao",
        data: m.data,
        patinete: `${m.patineteCodigo || `PAT${m.patineteId}`} • ${m.pontoNome || "Ponto"}`,
        cliente: "Oficina Interna",
        usuario: m.usuario || "Operador",
        descricao: m.descricao,
        valor: m.valor,
        status: m.status
      });
    });

    // Ordena do mais recente para o mais antigo
    listaNormalizada.sort((a, b) => new Date(b.data) - new Date(a.data));
    relatoriosGerais = listaNormalizada;

    atualizarCardsResumo();
    aplicarFiltros();

    try {
      renderizarGraficos();
    } catch (erroGrafico) {
      console.error("Erro ao montar os gráficos:", erroGrafico);
      mostrarToastRelatorio("Os registros foram carregados, mas houve um erro nos gráficos");
    }
  } catch (error) {
    console.error("Erro ao carregar relatórios:", error);
    mostrarToastRelatorio("Erro ao carregar dados do servidor");
  }
}

function atualizarCardsResumo() {
  if (!resumoServidor) return;

  const { financeiro } = resumoServidor;
  const elLoc = document.getElementById("totalLocacoes");
  const elFat = document.getElementById("totalFaturamento");
  const elMan = document.getElementById("totalManutencao");
  const elLuc = document.getElementById("totalLucro");

  if (elLoc) elLoc.innerText = financeiro.totalLocacoes;
  if (elFat) elFat.innerText = `R$ ${financeiro.faturamentoTotal.toFixed(2)}`;
  if (elMan) elMan.innerText = `R$ ${financeiro.gastoManutencaoTotal.toFixed(2)}`;
  if (elLuc) {
    elLuc.innerText = `R$ ${financeiro.lucroTotal.toFixed(2)}`;
    elLuc.style.color = financeiro.lucroTotal >= 0 ? "#22c55e" : "#ef4444";
  }

  const variacoes = resumoServidor.comparacao?.variacoes || {};
  atualizarIndicadorVariacao("variacaoLocacoes", variacoes.locacoes, "Locações");
  atualizarIndicadorVariacao("variacaoFaturamento", variacoes.faturamento, "Faturamento");
  atualizarIndicadorVariacao("variacaoManutencao", variacoes.manutencao, "Manutenção", true);
  atualizarIndicadorVariacao("variacaoLucro", variacoes.lucro, "Lucro");
  renderizarAnalisesDetalhadas();
}

function atualizarIndicadorVariacao(id, valor, nome, menorMelhor = false) {
  const elemento = document.getElementById(id);
  if (!elemento) return;
  if (valor === null || valor === undefined) {
    elemento.textContent = `${nome}: sem base no mês anterior`;
    elemento.className = "variacao-card neutra";
    return;
  }
  const percentual = Number(valor) || 0;
  const direcao = percentual > 0 ? "aumentou" : percentual < 0 ? "diminuiu" : "sem alteração";
  const icone = percentual > 0 ? "↑" : percentual < 0 ? "↓" : "−";
  const favoravel = percentual === 0 ? null : menorMelhor ? percentual < 0 : percentual > 0;
  elemento.textContent = percentual === 0
    ? `${icone} ${nome} sem alteração`
    : `${icone} ${nome} ${direcao} ${Math.abs(percentual).toFixed(1)}%`;
  elemento.className = `variacao-card ${favoravel === null ? "neutra" : favoravel ? "positiva" : "negativa"}`;
}

function escaparRelatorio(valor) {
  return String(valor ?? "").replace(/[&<>'"]/g, caractere => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[caractere]));
}

function renderizarAnalisesDetalhadas() {
  if (!resumoServidor) return;
  const moeda = valor => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor) || 0);
  const renderizar = (id, lista, montar) => {
    const container = document.getElementById(id);
    if (!container) return;
    container.innerHTML = lista.length ? lista.map(montar).join("") : '<div class="ranking-vazio">Nenhum dado no período.</div>';
  };

  renderizar("rankingPontos", resumoServidor.faturamentoPorPonto || [], item => `
    <div class="ranking-item"><strong>${escaparRelatorio(item.pontoNome)}</strong><span>${item.locacoes} locações</span><span>Receita ${moeda(item.faturamento)}</span><span>Lucro ${moeda(item.lucro)}</span></div>`);
  renderizar("rankingOperadores", resumoServidor.desempenhoPorOperador || [], item => `
    <div class="ranking-item"><strong>${escaparRelatorio(item.operador)}</strong><span>${item.iniciadas} iniciadas</span><span>${item.finalizadas} finalizadas</span><span>${moeda(item.faturamento)}</span></div>`);
  renderizar("rankingPatinetes", (resumoServidor.usoPorPatinete || []).filter(item => item.totalLocacoes || item.gastoManutencao), item => `
    <div class="ranking-item"><strong>${escaparRelatorio(item.codigo)}</strong><span>${item.totalLocacoes} locações</span><span>Custo ${moeda(item.gastoManutencao)}</span><span>Lucro ${moeda(item.lucroLiquido)}</span></div>`);
}

// Renderização dos Gráficos (Barra e Pizza)
function renderizarGraficos() {
  if (!resumoServidor || typeof Chart === "undefined") return;

  const formatarMoedaCompacta = valor => new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: Math.abs(valor) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(valor) >= 1000 ? 1 : 0
  }).format(valor);

  const formatarMoeda = valor => new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(valor);

  // 1. Gráfico em Barras: Comparativo diário
  const porDia = resumoServidor.porDia || {};
  let labels = Object.keys(porDia).sort();

  if (labels.length === 0) {
    labels = [new Date().toISOString().slice(0, 10)];
    porDia[labels[0]] = { faturamento: 0, manutencao: 0, locacoes: 0 };
  }

  const faturamentos = labels.map(d => porDia[d]?.faturamento || 0);
  const manutencoes = labels.map(d => porDia[d]?.manutencao || 0);
  const lucros = labels.map(d => (porDia[d]?.faturamento || 0) - (porDia[d]?.manutencao || 0));
  const quantidadesLocacoes = labels.map(d => porDia[d]?.locacoes || 0);

  const ctxBarra = document.getElementById("graficoBarra");
  if (ctxBarra) {
    if (chartBarra) chartBarra.destroy();

    chartBarra = new Chart(ctxBarra, {
      type: "bar",
      data: {
        labels: labels.map(d => {
          const partes = d.split("-");
          return partes.length === 3 ? `${partes[2]}/${partes[1]}` : d;
        }),
        datasets: [
          {
            label: "Faturamento (R$)",
            data: faturamentos,
            backgroundColor: "rgba(59, 130, 246, 0.82)",
            borderColor: "#60a5fa",
            borderWidth: 1,
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 38
          },
          {
            label: "Manutenção (R$)",
            data: manutencoes,
            backgroundColor: "rgba(245, 158, 11, 0.78)",
            borderColor: "#fbbf24",
            borderWidth: 1,
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 38
          },
          {
            label: "Lucro Líquido (R$)",
            data: lucros,
            type: "line",
            borderColor: "#34d399",
            backgroundColor: "rgba(52, 211, 153, 0.16)",
            pointBackgroundColor: "#d1fae5",
            pointBorderColor: "#10b981",
            pointRadius: 3,
            pointHoverRadius: 6,
            borderWidth: 3,
            tension: 0.32,
            fill: false
          },
          {
            label: "Quantidade de locações",
            data: quantidadesLocacoes,
            type: "line",
            yAxisID: "yQuantidade",
            borderColor: "#c084fc",
            backgroundColor: "rgba(192, 132, 252, 0.14)",
            pointBackgroundColor: "#e9d5ff",
            pointBorderColor: "#9333ea",
            pointRadius: 3,
            pointHoverRadius: 6,
            borderWidth: 2,
            borderDash: [5, 4],
            tension: 0.32
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 8, right: 8 } },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: "#cbd5e1",
              usePointStyle: true,
              pointStyle: "circle",
              boxWidth: 8,
              padding: 18,
              font: { size: 11, weight: "600" }
            }
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, .96)",
            borderColor: "rgba(148, 163, 184, .28)",
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: contexto => contexto.dataset.yAxisID === "yQuantidade"
                ? ` ${contexto.dataset.label}: ${contexto.parsed.y}`
                : ` ${contexto.dataset.label}: ${formatarMoeda(contexto.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            grid: { display: false },
            border: { color: "rgba(148,163,184,.18)" }
          },
          y: {
            beginAtZero: true,
            grace: "15%",
            ticks: { color: "#94a3b8", maxTicksLimit: 6, callback: valor => formatarMoedaCompacta(valor) },
            grid: { color: "rgba(148,163,184,.10)", drawTicks: false },
            border: { display: false }
          },
          yQuantidade: {
            beginAtZero: true,
            position: "right",
            suggestedMax: Math.max(3, ...quantidadesLocacoes),
            ticks: { color: "#c084fc", precision: 0, maxTicksLimit: 5, stepSize: 1 },
            grid: { display: false },
            border: { display: false }
          }
        }
      }
    });
  }

  // 2. Gráfico em Pizza: Proporção por Forma de Pagamento
  const porPagamento = resumoServidor.porPagamento || {};
  let labelsPizza = Object.keys(porPagamento);
  let valoresPizza = labelsPizza.map(k => porPagamento[k]);

  if (labelsPizza.length === 0) {
    labelsPizza = ["Sem locações no período"];
    valoresPizza = [1];
  }

  const ctxPizza = document.getElementById("graficoPizza");
  if (ctxPizza) {
    if (chartPizza) chartPizza.destroy();

    chartPizza = new Chart(ctxPizza, {
      type: "doughnut",
      data: {
        labels: labelsPizza,
        datasets: [
          {
            data: valoresPizza,
            backgroundColor: [
              "rgba(59, 130, 246, 0.85)",
              "rgba(34, 197, 94, 0.85)",
              "rgba(168, 85, 247, 0.85)",
              "rgba(245, 158, 11, 0.85)",
              "rgba(239, 68, 68, 0.85)"
            ],
            borderColor: "#111827",
            borderWidth: 3,
            hoverBorderColor: "#f8fafc",
            hoverOffset: 10,
            spacing: 2,
            borderRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        layout: { padding: 8 },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: "#cbd5e1",
              usePointStyle: true,
              pointStyle: "circle",
              boxWidth: 8,
              padding: 16,
              font: { size: 11, weight: "600" }
            }
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, .96)",
            borderColor: "rgba(148, 163, 184, .28)",
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: contexto => {
                const total = contexto.dataset.data.reduce((soma, valor) => soma + Number(valor || 0), 0);
                const percentual = total ? (Number(contexto.raw || 0) / total) * 100 : 0;
                return ` ${contexto.label}: ${formatarMoeda(contexto.raw)} (${percentual.toFixed(1)}%)`;
              }
            }
          }
        }
      }
    });
  }
}

// Filtros e Renderização da Tabela
function aplicarFiltros() {
  const tipo = document.getElementById("filtroTipo").value;
  const dataFiltro = document.getElementById("filtroData").value;
  const clienteFiltro = document.getElementById("filtroCliente").value.trim().toLowerCase();
  const buscaGeral = document.getElementById("buscaTexto").value.trim().toLowerCase();

  sessionStorage.setItem("filtrosRelatorio", JSON.stringify({ tipo, dataFiltro, clienteFiltro, buscaGeral }));

  const filtrados = relatoriosGerais.filter(item => {
    if (tipo !== "todos" && item.tipo !== tipo) return false;

    if (dataFiltro) {
      const dataItem = (item.data || "").slice(0, 10);
      if (dataItem !== dataFiltro) return false;
    }

    if (clienteFiltro) {
      const clienteNome = (item.cliente || "").toLowerCase();
      const usuarioNome = (item.usuario || "").toLowerCase();
      if (!clienteNome.includes(clienteFiltro) && !usuarioNome.includes(clienteFiltro)) return false;
    }

    if (buscaGeral) {
      const textoGeral = `${item.patinete} ${item.cliente} ${item.descricao} ${item.usuario}`.toLowerCase();
      if (!textoGeral.includes(buscaGeral)) return false;
    }

    return true;
  });

  renderizarTabela(filtrados);
}

function limparFiltros() {
  document.getElementById("filtroTipo").value = "todos";
  document.getElementById("filtroData").value = "";
  document.getElementById("filtroCliente").value = "";
  document.getElementById("buscaTexto").value = "";
  sessionStorage.removeItem("filtrosRelatorio");
  aplicarFiltros();
}

function renderizarTabela(dados) {
  const tbody = document.getElementById("tabelaRelatorios");
  const contador = document.getElementById("contadorTabela");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (contador) contador.innerText = `${dados.length} registro(s) no período`;

  if (dados.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="sem-registro">Nenhum registro encontrado no período selecionado.</td>
      </tr>
    `;
    return;
  }

  dados.forEach(item => {
    const tr = document.createElement("tr");
    const dataFormatada = item.data ? new Date(item.data).toLocaleString("pt-BR") : "-";
    const tagClasse = item.tipo === "locacao" ? "locacao" : "manutencao";
    const tagTexto = item.tipo === "locacao" ? "Locação" : "Manutenção";
    const valorCor = item.tipo === "locacao" ? "#22c55e" : "#f59e0b";

    tr.innerHTML = `
      <td>${dataFormatada}</td>
      <td><span class="status-tag ${tagClasse}">${tagTexto}</span></td>
      <td><strong>${item.patinete}</strong></td>
      <td>${item.cliente} <small style="color:var(--muted); display:block;">Operador: ${item.usuario}</small></td>
      <td>${item.descricao}</td>
      <td style="color:${valorCor}; font-weight:bold;">R$ ${parseFloat(item.valor || 0).toFixed(2)}</td>
    `;

    tbody.appendChild(tr);
  });
}

function exportarRelatorioSelecionado() {
  const input = document.getElementById("inputMesExportar");
  const mes = input ? input.value : "";
  if (!mes) {
    mostrarToastRelatorio("Selecione um mês válido para exportar");
    return;
  }
  const tipo = document.getElementById("tipoExportacao")?.value || "detalhado";
  if (tipo === "pdf") {
    window.print();
    return;
  }
  if (tipo === "detalhado") {
    api.baixarPlanilhaFaturamento("mes_especifico", mes);
    return;
  }
  if (tipo === "excel") {
    exportarExcel(mes);
    return;
  }
  exportarResumoCsv(mes);
}

function baixarConteudo(conteudo, tipo, nome) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function exportarResumoCsv(mes) {
  const resumoExportacao = await api.getResumoRelatorio(mes);
  const f = resumoExportacao?.financeiro || {};
  const p = f.pagamentos || {};
  const linhas = [
    ["Indicador", "Valor"], ["Período", mes], ["Total de locações", f.totalLocacoes || 0],
    ["Faturamento", f.faturamentoTotal || 0], ["Manutenção", f.gastoManutencaoTotal || 0],
    ["Lucro", f.lucroTotal || 0], ["Recebido", p.recebido || 0], ["Pendente", p.pendente || 0],
    ["Multas", p.multas || 0], ["Cancelado", p.cancelado || 0]
  ];
  const csv = linhas.map(linha => linha.map(valor => `"${String(valor).replace(/"/g, '""')}"`).join(";")).join("\n");
  baixarConteudo(`\uFEFF${csv}`, "text/csv;charset=utf-8", `relatorio-resumido-${mes}.csv`);
}

async function exportarExcel(mes) {
  const [locacoes, manutencoes] = await Promise.all([api.getLocacoes(), api.getManutencoes()]);
  const registros = [
    ...locacoes.filter(item => (item.dataInicio || "").slice(0, 7) === mes).map(item => ({ data: item.dataInicio, tipo: "Locação", patinete: item.patineteCodigo, cliente: item.cliente, usuario: item.usuarioOperador, valor: item.valorTotal })),
    ...manutencoes.filter(item => (item.data || "").slice(0, 7) === mes).map(item => ({ data: item.data, tipo: "Manutenção", patinete: item.patineteCodigo, cliente: "Oficina", usuario: item.usuario, valor: item.valor }))
  ];
  const linhas = registros.map(item => `<tr><td>${escaparRelatorio(item.data)}</td><td>${escaparRelatorio(item.tipo)}</td><td>${escaparRelatorio(item.patinete)}</td><td>${escaparRelatorio(item.cliente)}</td><td>${escaparRelatorio(item.usuario)}</td><td>${Number(item.valor || 0).toFixed(2)}</td></tr>`).join("");
  const html = `<html><meta charset="UTF-8"><body><table><thead><tr><th>Data</th><th>Tipo</th><th>Patinete</th><th>Cliente</th><th>Operador</th><th>Valor</th></tr></thead><tbody>${linhas}</tbody></table></body></html>`;
  baixarConteudo(html, "application/vnd.ms-excel;charset=utf-8", `relatorio-${mes}.xls`);
}

// INICIALIZAÇÃO
const inputMes = document.getElementById("inputMesExportar");
if (inputMes) {
  const agora = new Date();
  inputMes.value = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

const filtrosSalvos = (() => {
  try { return JSON.parse(sessionStorage.getItem("filtrosRelatorio")) || {}; } catch { return {}; }
})();
document.getElementById("filtroTipo").value = filtrosSalvos.tipo || "todos";
document.getElementById("filtroData").value = filtrosSalvos.dataFiltro || "";
document.getElementById("filtroCliente").value = filtrosSalvos.clienteFiltro || "";
document.getElementById("buscaTexto").value = filtrosSalvos.buscaGeral || "";

const periodoSalvo = sessionStorage.getItem("periodoRelatorio") || "atual";
periodoAtual = periodoSalvo;
document.getElementById("seletorPeriodoMes").value = periodoSalvo;

selecionarSecaoRelatorio(sessionStorage.getItem("secaoRelatorioAtiva") || "resumo", false);
carregarRelatoriosDoServidor();
setInterval(() => {
  if (!document.hidden) carregarRelatoriosDoServidor();
}, 30000);
window.addEventListener("focus", carregarRelatoriosDoServidor);
