// E-Scooter GO - Exportação do relatório em planilha Excel (.xlsx)
const ExcelJS = require("exceljs");
const db = require("./database");

const FUSO_HORARIO = process.env.APP_TZ || "America/Sao_Paulo";
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const COR_TITULO = "FF1E3A8A";
const COR_CABECALHO = "FF1D4ED8";
const COR_LINHA_ALTERNADA = "FFF1F5F9";
const COR_TOTAL = "FFE2E8F0";
const COR_BORDA = "FFCBD5E1";

const FORMATO_MOEDA = '"R$" #,##0.00';
const FORMATO_DATA_HORA = "dd/mm/yyyy hh:mm";

const SITUACAO_LOCACAO = { ativa: "Em andamento", finalizada: "Finalizada", cancelada: "Cancelada" };
const SITUACAO_MANUTENCAO = { em_manutencao: "Em manutenção", concluida: "Concluída" };
const SITUACAO_PATINETE = { livre: "Disponível", locado: "Alugado", atrasado: "Alugado", manutencao: "Em manutenção" };
const PRIORIDADE = { baixa: "Baixa", media: "Média", urgente: "Urgente" };

// ==========================================
// DATAS
// ==========================================

const partesData = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_HORARIO, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

// O Excel não tem fuso: grava a data com o horário de Brasília "como está"
function dataExcel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const p = Object.fromEntries(partesData.formatToParts(d).map(x => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
}

const dataBR = dia => (dia ? dia.split("-").reverse().join("/") : "");

function descreverPeriodo(resumo) {
  const { inicio, fim } = resumo.intervalo || {};
  if (!inicio) return "Histórico completo";
  if (/^\d{4}-\d{2}$/.test(resumo.periodo)) {
    const [ano, mes] = resumo.periodo.split("-");
    const nome = MESES[Number(mes) - 1];
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano} (${dataBR(inicio)} a ${dataBR(fim)})`;
  }
  return `${dataBR(inicio)} a ${dataBR(fim)}`;
}

// ==========================================
// FORMATAÇÃO DAS ABAS
// ==========================================

function bordaFina(celula) {
  const lado = { style: "thin", color: { argb: COR_BORDA } };
  celula.border = { top: lado, left: lado, bottom: lado, right: lado };
}

function adicionarTitulo(aba, titulo, periodo, colunas) {
  aba.mergeCells(1, 1, 1, colunas);
  const celulaTitulo = aba.getCell(1, 1);
  celulaTitulo.value = titulo;
  celulaTitulo.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  celulaTitulo.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_TITULO } };
  celulaTitulo.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  aba.getRow(1).height = 30;

  aba.mergeCells(2, 1, 2, colunas);
  const geradoEm = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_HORARIO, dateStyle: "short", timeStyle: "short" }).format(new Date());
  aba.getCell(2, 1).value = `Período: ${periodo}   •   Gerado em ${geradoEm}`;
  aba.getCell(2, 1).font = { italic: true, color: { argb: "FF475569" } };
  aba.getRow(2).height = 20;
}

// Cria uma tabela com cabeçalho colorido, linhas alternadas, total e filtro
function adicionarTabela(aba, linhaInicial, colunas, registros, { total = null, mensagemVazia = "Nenhum registro no período." } = {}) {
  const cabecalho = aba.getRow(linhaInicial);
  colunas.forEach((coluna, i) => {
    const celula = cabecalho.getCell(i + 1);
    celula.value = coluna.titulo;
    celula.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celula.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_CABECALHO } };
    celula.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    bordaFina(celula);
  });
  cabecalho.height = 24;

  if (!registros.length) {
    aba.mergeCells(linhaInicial + 1, 1, linhaInicial + 1, colunas.length);
    const celula = aba.getCell(linhaInicial + 1, 1);
    celula.value = mensagemVazia;
    celula.font = { italic: true, color: { argb: "FF64748B" } };
    celula.alignment = { horizontal: "center" };
    return linhaInicial + 2;
  }

  registros.forEach((registro, indice) => {
    const linha = aba.getRow(linhaInicial + 1 + indice);
    colunas.forEach((coluna, i) => {
      const celula = linha.getCell(i + 1);
      celula.value = registro[coluna.campo] ?? "";
      if (coluna.formato) celula.numFmt = coluna.formato;
      celula.alignment = { vertical: "middle", horizontal: coluna.alinhamento || "left", wrapText: Boolean(coluna.quebrar) };
      if (indice % 2 === 1) celula.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_LINHA_ALTERNADA } };
      bordaFina(celula);
    });
  });

  const ultimaLinha = linhaInicial + registros.length;
  aba.autoFilter = aba.autoFilter || { from: { row: linhaInicial, column: 1 }, to: { row: ultimaLinha, column: colunas.length } };

  if (total) {
    const linhaTotal = aba.getRow(ultimaLinha + 1);
    colunas.forEach((coluna, i) => {
      const celula = linhaTotal.getCell(i + 1);
      celula.value = i === 0 ? "TOTAL" : (total[coluna.campo] ?? "");
      if (coluna.formato && typeof celula.value === "number") celula.numFmt = coluna.formato;
      celula.font = { bold: true };
      celula.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COR_TOTAL } };
      celula.alignment = { horizontal: i === 0 ? "left" : (coluna.alinhamento || "left") };
      bordaFina(celula);
    });
    return ultimaLinha + 3;
  }
  return ultimaLinha + 2;
}

function definirLarguras(aba, larguras) {
  larguras.forEach((largura, i) => { aba.getColumn(i + 1).width = largura; });
}

function tituloSecao(aba, linha, texto) {
  const celula = aba.getCell(linha, 1);
  celula.value = texto;
  celula.font = { bold: true, size: 13, color: { argb: COR_TITULO } };
  return linha + 1;
}

const somar = (lista, campo) => Math.round(lista.reduce((s, item) => s + (Number(item[campo]) || 0), 0) * 100) / 100;

// ==========================================
// GERAÇÃO DA PLANILHA
// ==========================================

// filtro: igual ao do relatório ("atual", "anterior", "AAAA-MM", { inicio, fim } ...)
async function gerarPlanilhaRelatorio(filtro) {
  const [resumo, todasLocacoes, todasManutencoes] = await Promise.all([
    db.obterResumoGeral(filtro), db.listarLocacoes(), db.listarManutencoes()
  ]);
  const { inicio, fim } = resumo.intervalo;
  const noPeriodo = data => {
    const dia = db.diaLocal(data);
    return (!inicio || dia >= inicio) && (!fim || dia <= fim);
  };
  const locacoes = todasLocacoes.filter(l => noPeriodo(l.dataInicio)).sort((a, b) => new Date(a.dataInicio) - new Date(b.dataInicio));
  const manutencoes = todasManutencoes.filter(m => noPeriodo(m.data)).sort((a, b) => new Date(a.data) - new Date(b.data));
  const periodo = descreverPeriodo(resumo);
  const fin = resumo.financeiro;

  const livro = new ExcelJS.Workbook();
  livro.creator = "E-Scooter GO";
  livro.created = new Date();

  // ----- Aba Resumo -----
  const abaResumo = livro.addWorksheet("Resumo", { views: [{ showGridLines: false }] });
  definirLarguras(abaResumo, [34, 18, 18, 18, 18]);
  adicionarTitulo(abaResumo, "E-Scooter GO — Relatório de Faturamento", periodo, 5);

  let linha = tituloSecao(abaResumo, 4, "Indicadores do período");
  linha = adicionarTabela(abaResumo, linha, [
    { titulo: "Indicador", campo: "nome" },
    { titulo: "Valor", campo: "valor", alinhamento: "right" }
  ], [
    { nome: "Total de locações", valor: fin.totalLocacoes },
    { nome: "Faturamento bruto", valor: fin.faturamentoTotal },
    { nome: "Gasto com manutenção", valor: fin.gastoManutencaoTotal },
    { nome: "Lucro líquido", valor: fin.lucroTotal },
    { nome: "Recebido (locações finalizadas)", valor: fin.pagamentos.recebido },
    { nome: "Em andamento (a receber)", valor: fin.pagamentos.pendente },
    { nome: "Multas por atraso", valor: fin.pagamentos.multas }
  ]);
  // Linhas 6 a 12: a primeira é a contagem de locações; as demais são valores em reais
  for (let r = 7; r <= 12; r++) abaResumo.getCell(r, 2).numFmt = FORMATO_MOEDA;
  abaResumo.getCell(9, 2).font = { bold: true, color: { argb: fin.lucroTotal >= 0 ? "FF047857" : "FFB91C1C" } };

  linha = tituloSecao(abaResumo, linha, "Faturamento por forma de pagamento");
  const pagamentos = Object.entries(resumo.porPagamento).map(([forma, valor]) => ({
    forma, valor, percentual: fin.faturamentoTotal ? valor / fin.faturamentoTotal : 0
  })).sort((a, b) => b.valor - a.valor);
  linha = adicionarTabela(abaResumo, linha, [
    { titulo: "Forma de pagamento", campo: "forma" },
    { titulo: "Valor", campo: "valor", formato: FORMATO_MOEDA, alinhamento: "right" },
    { titulo: "% do total", campo: "percentual", formato: "0.0%", alinhamento: "right" }
  ], pagamentos, { total: { valor: fin.faturamentoTotal, percentual: pagamentos.length ? 1 : "" } });

  linha = tituloSecao(abaResumo, linha, "Desempenho por ponto");
  linha = adicionarTabela(abaResumo, linha, [
    { titulo: "Ponto", campo: "pontoNome" },
    { titulo: "Locações", campo: "locacoes", alinhamento: "center" },
    { titulo: "Faturamento", campo: "faturamento", formato: FORMATO_MOEDA, alinhamento: "right" },
    { titulo: "Manutenção", campo: "despesas", formato: FORMATO_MOEDA, alinhamento: "right" },
    { titulo: "Lucro", campo: "lucro", formato: FORMATO_MOEDA, alinhamento: "right" }
  ], resumo.faturamentoPorPonto, { total: {
    locacoes: somar(resumo.faturamentoPorPonto, "locacoes"), faturamento: somar(resumo.faturamentoPorPonto, "faturamento"),
    despesas: somar(resumo.faturamentoPorPonto, "despesas"), lucro: somar(resumo.faturamentoPorPonto, "lucro")
  } });

  tituloSecao(abaResumo, linha, "Desempenho por operador");
  adicionarTabela(abaResumo, linha + 1, [
    { titulo: "Operador", campo: "operador" },
    { titulo: "Locações iniciadas", campo: "iniciadas", alinhamento: "center" },
    { titulo: "Finalizadas", campo: "finalizadas", alinhamento: "center" },
    { titulo: "Faturamento", campo: "faturamento", formato: FORMATO_MOEDA, alinhamento: "right" }
  ], resumo.desempenhoPorOperador);
  abaResumo.autoFilter = undefined;

  // ----- Aba Locações -----
  const abaLocacoes = livro.addWorksheet("Locações", { views: [{ state: "frozen", ySplit: 3 }] });
  definirLarguras(abaLocacoes, [8, 17, 17, 11, 18, 26, 17, 11, 18, 13, 11, 13, 15, 14]);
  adicionarTitulo(abaLocacoes, "Locações", periodo, 14);
  adicionarTabela(abaLocacoes, 3, [
    { titulo: "Nº", campo: "id", alinhamento: "center" },
    { titulo: "Início", campo: "inicio", formato: FORMATO_DATA_HORA, alinhamento: "center" },
    { titulo: "Devolução", campo: "fim", formato: FORMATO_DATA_HORA, alinhamento: "center" },
    { titulo: "Patinete", campo: "patinete", alinhamento: "center" },
    { titulo: "Ponto", campo: "ponto" },
    { titulo: "Cliente", campo: "cliente" },
    { titulo: "Telefone", campo: "telefone" },
    { titulo: "Tempo (min)", campo: "tempo", alinhamento: "center" },
    { titulo: "Pagamento", campo: "pagamento" },
    { titulo: "Valor base", campo: "valorBase", formato: FORMATO_MOEDA, alinhamento: "right" },
    { titulo: "Multa", campo: "multa", formato: FORMATO_MOEDA, alinhamento: "right" },
    { titulo: "Total", campo: "total", formato: FORMATO_MOEDA, alinhamento: "right" },
    { titulo: "Situação", campo: "situacao", alinhamento: "center" },
    { titulo: "Operador", campo: "operador" }
  ], locacoes.map(l => ({
    id: l.id, inicio: dataExcel(l.dataInicio), fim: dataExcel(l.dataFim), patinete: l.patineteCodigo, ponto: l.pontoNome,
    cliente: l.cliente, telefone: l.telefone, tempo: l.tempoMinutos, pagamento: l.pagamento, valorBase: l.valorBase,
    multa: l.multa, total: l.valorTotal, situacao: SITUACAO_LOCACAO[l.status] || l.status, operador: l.usuarioOperador
  })), { total: {
    tempo: somar(locacoes, "tempoMinutos"), valorBase: somar(locacoes, "valorBase"),
    multa: somar(locacoes, "multa"), total: somar(locacoes, "valorTotal")
  } });

  // ----- Aba Manutenções -----
  const abaManutencoes = livro.addWorksheet("Manutenções", { views: [{ state: "frozen", ySplit: 3 }] });
  definirLarguras(abaManutencoes, [8, 17, 17, 11, 18, 32, 32, 11, 15, 20, 15, 13]);
  adicionarTitulo(abaManutencoes, "Manutenções", periodo, 12);
  adicionarTabela(abaManutencoes, 3, [
    { titulo: "Nº", campo: "id", alinhamento: "center" },
    { titulo: "Entrada", campo: "data", formato: FORMATO_DATA_HORA, alinhamento: "center" },
    { titulo: "Liberação", campo: "liberacao", formato: FORMATO_DATA_HORA, alinhamento: "center" },
    { titulo: "Patinete", campo: "patinete", alinhamento: "center" },
    { titulo: "Ponto", campo: "ponto" },
    { titulo: "Problema", campo: "descricao", quebrar: true },
    { titulo: "Diagnóstico", campo: "diagnostico", quebrar: true },
    { titulo: "Prioridade", campo: "prioridade", alinhamento: "center" },
    { titulo: "Situação", campo: "situacao", alinhamento: "center" },
    { titulo: "Responsável", campo: "responsavel" },
    { titulo: "Registrado por", campo: "usuario" },
    { titulo: "Custo", campo: "valor", formato: FORMATO_MOEDA, alinhamento: "right" }
  ], manutencoes.map(m => ({
    id: m.id, data: dataExcel(m.data), liberacao: dataExcel(m.dataLiberacao), patinete: m.patineteCodigo, ponto: m.pontoNome,
    descricao: m.descricao, diagnostico: m.diagnostico, prioridade: PRIORIDADE[m.prioridade] || m.prioridade,
    situacao: SITUACAO_MANUTENCAO[m.status] || m.status, responsavel: m.responsavelServico, usuario: m.usuario, valor: m.valor
  })), { total: { valor: somar(manutencoes, "valor") } });

  // ----- Aba Frota -----
  const abaFrota = livro.addWorksheet("Frota", { views: [{ state: "frozen", ySplit: 3 }] });
  definirLarguras(abaFrota, [11, 20, 18, 11, 16, 15, 15, 15, 15]);
  adicionarTitulo(abaFrota, "Frota — uso no período", periodo, 9);
  const frota = resumo.usoPorPatinete;
  adicionarTabela(abaFrota, 3, [
    { titulo: "Patinete", campo: "codigo", alinhamento: "center" },
    { titulo: "Modelo", campo: "modelo" },
    { titulo: "Ponto", campo: "pontoNome" },
    { titulo: "Bateria", campo: "bateria", formato: "0%", alinhamento: "center" },
    { titulo: "Situação atual", campo: "situacao", alinhamento: "center" },
    { titulo: "Locações", campo: "totalLocacoes", alinhamento: "center" },
    { titulo: "Faturamento", campo: "faturamentoGerado", formato: FORMATO_MOEDA, alinhamento: "right" },
    { titulo: "Manutenção", campo: "gastoManutencao", formato: FORMATO_MOEDA, alinhamento: "right" },
    { titulo: "Lucro", campo: "lucroLiquido", formato: FORMATO_MOEDA, alinhamento: "right" }
  ], frota.map(p => ({ ...p, bateria: (Number(p.bateria) || 0) / 100, situacao: SITUACAO_PATINETE[p.status] || p.status })), {
    total: {
      totalLocacoes: somar(frota, "totalLocacoes"), faturamentoGerado: somar(frota, "faturamentoGerado"),
      gastoManutencao: somar(frota, "gastoManutencao"), lucroLiquido: somar(frota, "lucroLiquido")
    },
    mensagemVazia: "Nenhum patinete cadastrado."
  });

  const sufixo = inicio ? (resumo.periodo.length === 7 ? resumo.periodo : `${inicio}_a_${fim}`) : "historico-completo";
  return { buffer: await livro.xlsx.writeBuffer(), nomeArquivo: `relatorio-escooter-${sufixo}.xlsx` };
}

module.exports = { gerarPlanilhaRelatorio };
