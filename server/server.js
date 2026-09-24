const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;
const pastaPublica = path.resolve(__dirname, "..", "public");

// Middlewares
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  if (req.path.startsWith("/data/")) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(pastaPublica));

const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(48).toString("hex");
const TOKEN_DURATION_MS = 8 * 60 * 60 * 1000;
const tentativasLogin = new Map();

function limitarLogin(req, res, next) {
  const chave = req.ip || req.socket.remoteAddress || "desconhecido";
  const agora = Date.now();
  const registro = tentativasLogin.get(chave) || { quantidade: 0, inicio: agora };
  if (agora - registro.inicio > 15 * 60 * 1000) {
    registro.quantidade = 0;
    registro.inicio = agora;
  }
  registro.quantidade += 1;
  tentativasLogin.set(chave, registro);
  if (registro.quantidade > 20) return res.status(429).json({ erro: "Muitas tentativas de login. Aguarde alguns minutos." });
  next();
}

function assinarToken(usuario) {
  const payload = Buffer.from(JSON.stringify({
    id: usuario.id,
    usuario: usuario.usuario,
    nome: usuario.nome,
    nivel: usuario.nivel || "operador",
    exp: Date.now() + TOKEN_DURATION_MS
  })).toString("base64url");
  const assinatura = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${assinatura}`;
}

async function autenticarRequisicao(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const [payload, assinatura] = token.split(".");
  if (!payload || !assinatura) return res.status(401).json({ erro: "Autenticação necessária." });
  const esperada = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  const assinaturaValida = assinatura.length === esperada.length && crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada));
  if (!assinaturaValida) return res.status(401).json({ erro: "Sessão inválida." });
  try {
    const usuario = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!usuario.exp || usuario.exp < Date.now()) return res.status(401).json({ erro: "Sessão expirada." });
    const usuarioAtual = await db.obterUsuarioSessao(usuario.id);
    if (!usuarioAtual || usuarioAtual.status !== "aprovado" || usuarioAtual.bloqueado) return res.status(401).json({ erro: "Conta sem acesso ao sistema." });
    req.usuario = { ...usuario, ...usuarioAtual };
    await db.registrarAtividadeUsuario(usuarioAtual.id);
    next();
  } catch {
    return res.status(401).json({ erro: "Sessão inválida." });
  }
}

function permitirNiveis(...niveis) {
  return (req, res, next) => niveis.includes(req.usuario.nivel)
    ? next()
    : res.status(403).json({ erro: "Você não tem permissão para realizar esta ação." });
}

const somenteAdmin = permitirNiveis("administrador");
const somenteOperacao = permitirNiveis("administrador", "operador");

function validarTexto(valor, campo, maximo = 120) {
  const texto = String(valor || "").trim();
  if (!texto) throw new Error(`${campo} é obrigatório.`);
  if (texto.length > maximo) throw new Error(`${campo} excede o limite de ${maximo} caracteres.`);
  if (/[<>]/.test(texto)) throw new Error(`${campo} contém caracteres não permitidos.`);
  return texto;
}

// ==========================================
// 1. ROTAS DE AUTENTICAÇÃO E USUÁRIOS
// ==========================================

app.post("/api/auth/cadastro", async (req, res) => {
  try {
    const { nome, usuario, senha } = req.body;

    if (!nome || !usuario || !senha) {
      return res.status(400).json({ erro: "Preencha todos os campos obrigatórios." });
    }

    if (usuario.length < 3) {
      return res.status(400).json({ erro: "O nome de usuário deve ter pelo menos 3 caracteres." });
    }

    if (senha.length < 4) {
      return res.status(400).json({ erro: "A senha deve ter pelo menos 4 caracteres." });
    }

    const nomeValidado = validarTexto(nome, "Nome", 100);
    if (!/^[a-zA-Z0-9._-]+$/.test(usuario)) return res.status(400).json({ erro: "O usuário deve conter apenas letras, números, ponto, hífen ou sublinhado." });
    const novoUsuario = await db.cadastrarUsuario(nomeValidado, usuario.trim(), senha);
    return res.status(201).json({
      mensagem: "Cadastro realizado com sucesso! Aguarde a aprovação do administrador para acessar o sistema.",
      usuario: novoUsuario
    });
  } catch (error) {
    return res.status(400).json({ erro: error.message });
  }
});

app.post("/api/auth/login", limitarLogin, async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
      return res.status(400).json({ erro: "Informe usuário e senha." });
    }

    const authResultado = await db.autenticarUsuario(usuario, senha);
    if (authResultado.erro) {
      return res.status(401).json({ erro: authResultado.erro });
    }

    const user = authResultado.usuario;
    tentativasLogin.delete(req.ip || req.socket.remoteAddress || "desconhecido");
    return res.json({
      mensagem: "Login realizado com sucesso!",
      usuario: user,
      token: assinarToken(user),
      expiraEm: new Date(Date.now() + TOKEN_DURATION_MS).toISOString()
    });
  } catch (error) {
    return res.status(500).json({ erro: "Erro interno no servidor de autenticação." });
  }
});

app.get("/api/admin/usuarios", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const usuarios = await db.listarUsuarios();
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao listar usuários." });
  }
});

app.put("/api/admin/usuarios/:id/status", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || (status !== "aprovado" && status !== "recusado")) {
      return res.status(400).json({ erro: "Status inválido. Use 'aprovado' ou 'recusado'." });
    }

    const atualizado = await db.alterarStatusUsuario(id, status, req.usuario.usuario);
    res.json({
      mensagem: `Status do usuário atualizado para '${status}' com sucesso!`,
      usuario: atualizado
    });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.put("/api/admin/usuarios/:id/nivel", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { nivel } = req.body;
    if (!["administrador", "operador"].includes(nivel)) {
      return res.status(400).json({ erro: "Nível de acesso inválido." });
    }
    const usuario = await db.alterarNivelUsuario(req.params.id, nivel, req.usuario.usuario);
    res.json({ mensagem: "Nível de acesso atualizado com sucesso!", usuario });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.put("/api/admin/usuarios/:id/ponto", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const usuario = await db.alterarPontoUsuario(req.params.id, req.body.pontoId, req.usuario.usuario);
    res.json({ mensagem: "Ponto de trabalho atualizado com sucesso!", usuario });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.put("/api/admin/usuarios/:id/bloqueio", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const usuario = await db.alterarBloqueioUsuario(req.params.id, Boolean(req.body.bloqueado), req.usuario.usuario);
    res.json({ mensagem: usuario.bloqueado ? "Operador bloqueado temporariamente." : "Operador desbloqueado.", usuario });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.delete("/api/admin/usuarios/:id", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const usuario = await db.excluirUsuarioRecusado(req.params.id, req.usuario.usuario);
    res.json({ mensagem: "Cadastro recusado excluído com sucesso!", usuario });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.get("/api/admin/historico-usuarios", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.listarHistoricoUsuarios());
  } catch (error) {
    res.status(500).json({ erro: "Erro ao listar o histórico de usuários." });
  }
});

// ==========================================
// 2. ROTAS DE PONTOS DE DISTRIBUIÇÃO
// ==========================================

app.get("/api/pontos", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const pontos = await db.listarPontos();
    res.json(pontos);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao listar pontos de distribuição." });
  }
});

app.post("/api/pontos", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { nome, localizacao } = req.body;
    if (!nome || !nome.trim()) {
      return res.status(400).json({ erro: "O nome do ponto é obrigatório." });
    }

    const novoPonto = await db.adicionarPonto(validarTexto(nome, "Nome", 100), validarTexto(localizacao || "Sem localização", "Localização", 180));
    res.status(201).json({
      mensagem: `Ponto '${novoPonto.nome}' cadastrado com sucesso!`,
      ponto: novoPonto
    });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.delete("/api/pontos/:id", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const removido = await db.removerPonto(id);
    res.json({
      mensagem: `Ponto '${removido.nome}' removido com sucesso!`,
      ponto: removido
    });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

// ==========================================
// 3. ROTAS DE PATINETES (FROTA)
// ==========================================

app.get("/api/patinetes", autenticarRequisicao, async (req, res) => {
  try {
    const pontoId = req.usuario.nivel === "operador" ? req.usuario.pontoId : null;
    const patinetes = req.usuario.nivel === "operador" && !pontoId ? [] : await db.listarPatinetes(pontoId);
    res.json(patinetes);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao listar patinetes." });
  }
});

app.get("/api/patinetes/:id/historico", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const historico = await db.obterHistoricoPatinete(req.params.id);
    res.json(historico);
  } catch (error) {
    res.status(404).json({ erro: error.message });
  }
});

app.post("/api/patinetes", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { quantidade, pontoId } = req.body;
    const qtd = parseInt(quantidade) || 1;
    const criados = await db.adicionarPatinetes(qtd, pontoId);
    res.status(201).json({
      mensagem: `${qtd} patinete(s) adicionado(s) à frota com sucesso!`,
      patinetes: criados
    });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.delete("/api/patinetes/:id", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const removido = await db.removerPatinete(id);
    res.json({
      mensagem: `Patinete ${removido.codigo} removido da frota com sucesso!`,
      patinete: removido
    });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.put("/api/patinetes/:id", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const atualizado = await db.atualizarPatinete(id, req.body);
    res.json({
      mensagem: "Patinete atualizado com sucesso!",
      patinete: atualizado
    });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

// ==========================================
// 4. ROTAS DE LOCAÇÕES
// ==========================================

app.get("/api/clientes", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const clientes = await db.listarClientes();
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao listar clientes." });
  }
});

app.get("/api/clientes/:id/historico", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const historico = await db.obterHistoricoCliente(req.params.id);
    res.json(historico);
  } catch (error) {
    res.status(404).json({ erro: error.message });
  }
});

app.get("/api/locacoes", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const locacoes = await db.listarLocacoes();
    res.json(locacoes);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao listar locações." });
  }
});

app.post("/api/locacoes/iniciar", autenticarRequisicao, somenteOperacao, async (req, res) => {
  try {
    const { patineteId, patineteIds, cliente, telefone, tempo, valorBase, pagamento } = req.body;
    const idsSelecionados = Array.isArray(patineteIds) ? patineteIds : [patineteId];
    const configuracoes = await db.obterConfig();

    if (!idsSelecionados.length || idsSelecionados.some(id => !id) || !cliente || !tempo || !pagamento) {
      return res.status(400).json({ erro: "Campos obrigatórios ausentes para iniciar a locação." });
    }
    if (idsSelecionados.length > Number(configuracoes.limitePatinetesLocacao || 5)) {
      return res.status(400).json({ erro: `O limite é de ${configuracoes.limitePatinetesLocacao || 5} patinetes por locação.` });
    }
    if (!configuracoes.temposDisponiveis.map(Number).includes(Number(tempo))) {
      return res.status(400).json({ erro: "Tempo de locação não permitido nas configurações." });
    }
    const valorConfigurado = Number(configuracoes.precos[String(tempo)] ?? configuracoes.precos[Number(tempo)]);
    if (!Number.isFinite(valorConfigurado) || valorConfigurado <= 0) {
      return res.status(400).json({ erro: "Preço não configurado para o tempo selecionado." });
    }

    const patinetesSolicitados = idsSelecionados.map(id => db.buscarPatinetePorId(id));
    if (req.usuario.nivel === "operador" && (!req.usuario.pontoId || patinetesSolicitados.some(p => p?.pontoId !== req.usuario.pontoId))) {
      return res.status(403).json({ erro: "Este patinete não pertence ao seu ponto de trabalho." });
    }

    const { patinetes, locacoes } = await db.iniciarLocacoes(
      idsSelecionados,
      validarTexto(cliente, "Cliente", 100),
      telefone || "",
      tempo,
      valorConfigurado,
      pagamento,
      req.usuario.usuario
    );

    return res.status(201).json({
      mensagem: `${patinetes.length} locação(ões) iniciada(s) com sucesso!`,
      locacoes,
      patinetes,
      locacao: locacoes[0],
      patinete: patinetes[0]
    });
  } catch (error) {
    return res.status(400).json({ erro: error.message });
  }
});

app.post("/api/locacoes/finalizar", autenticarRequisicao, somenteOperacao, async (req, res) => {
  try {
    const { patineteId, multa } = req.body;
    if (!patineteId) {
      return res.status(400).json({ erro: "ID do patinete é obrigatório." });
    }

    const patineteSolicitado = await db.buscarPatinetePorId(patineteId);
    if (!patineteSolicitado) {
      return res.status(404).json({ erro: "Patinete não encontrado." });
    }

    if (req.usuario.nivel === "operador" && (!req.usuario.pontoId || patineteSolicitado.pontoId !== req.usuario.pontoId)) {
      return res.status(403).json({ erro: "Este patinete não pertence ao seu ponto de trabalho." });
    }

    const { patinete, locacao } = await db.finalizarLocacao(patineteId, multa);
    res.json({
      mensagem: `Patinete ${patinete.codigo} devolvido com sucesso!`,
      patinete,
      locacao
    });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

// ==========================================
// 5. ROTAS DE MANUTENÇÃO
// ==========================================

app.get("/api/manutencoes", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.listarManutencoes());
  } catch (error) {
    res.status(500).json({ erro: "Erro ao listar manutenções." });
  }
});

app.post("/api/manutencoes", autenticarRequisicao, somenteOperacao, async (req, res) => {
  try {
   const { patineteId, descricao, valor } = req.body;

    // Validação dos campos obrigatórios
    if (!patineteId || !descricao) {
      return res.status(400).json({
        erro: "Patinete e descrição são obrigatórios."
      });
    }
    // Converte o valor recebido para número
    const valorNumerico = Number(valor);

    // Validação do valor da manutenção
    if (
      !Number.isFinite(valorNumerico) ||
      valorNumerico < 0 ||
      valorNumerico > 100000
    ) {
      return res.status(400).json({
        erro: "Valor da manutenção inválido. Informe um valor entre R$ 0,00 e R$ 100.000,00."
      });
    }

    const patineteSolicitado = await db.buscarPatinetePorId(patineteId);
    if (req.usuario.nivel === "operador" && (!req.usuario.pontoId || patineteSolicitado?.pontoId !== req.usuario.pontoId)) {
      return res.status(403).json({ erro: "Este patinete não pertence ao seu ponto de trabalho." });
    }


    const valorPermitido = req.usuario.nivel === "administrador" ? valor : 0;
    const { patinete, manutencao } = await db.registrarManutencao(
      patineteId,
      validarTexto(descricao, "Descrição", 300),
      valorPermitido,
      req.usuario.usuario
    );
    res.status(201).json({
      mensagem: `Patinete ${patinete.codigo} enviado para manutenção com sucesso!`,
      patinete,
      manutencao
    });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.post("/api/manutencoes/liberar", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { patineteId } = req.body;
    const patinete = await db.liberarManutencao(patineteId);
    res.json({
      mensagem: `Patinete ${patinete.codigo} revisado, 100% carregado e liberado para a frota!`,
      patinete
    });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.put("/api/admin/manutencoes/:id", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const manutencao = await db.atualizarManutencao(req.params.id, req.body || {});
    res.json({ mensagem: manutencao.status === "concluida" ? "Manutenção concluída e patinete liberado." : "Manutenção atualizada.", manutencao });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

app.get("/api/configuracoes", autenticarRequisicao, async (req, res) => {
  res.json(await db.obterConfig());
});

// ==========================================
// 6. ROTAS DE RELATÓRIOS & EXPORTAÇÃO
// ==========================================

app.get("/api/relatorios/resumo", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { mes } = req.query;
    const resumo = await db.obterResumoGeral(mes || null);
    res.json(resumo);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao consolidar resumo dos relatórios." });
  }
});

app.get("/api/relatorios/exportar/faturamento", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { periodo, mes } = req.query;
    const agora = new Date();
    const mesAtualStr = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;

    let locacoes = await db.listarLocacoes();
    let nomeArquivo = "faturamento-historico-completo.csv";

    if (mes && mes.match(/^\d{4}-\d{2}$/)) {
      locacoes = locacoes.filter(l => (l.dataInicio || "").slice(0, 7) === mes);
      nomeArquivo = `faturamento-${mes}.csv`;
    } else if (periodo === "mes_atual") {
      locacoes = locacoes.filter(l => (l.dataInicio || "").slice(0, 7) === mesAtualStr);
      nomeArquivo = `faturamento-${mesAtualStr}.csv`;
    }

    let csv = "ID;Data;Patinete;Ponto;Cliente;Telefone;Tempo (min);Forma de Pagamento;Valor Base (R$);Multa (R$);Valor Total (R$);Status;Operador\n";

    locacoes.forEach(loc => {
      const dataFormatada = loc.dataInicio ? new Date(loc.dataInicio).toLocaleString("pt-BR") : "";
      csv += `${loc.id};"${dataFormatada}";"${loc.patineteCodigo}";"${loc.pontoNome || "Geral"}";"${loc.cliente}";"${loc.telefone}";${loc.tempoMinutos};"${loc.pagamento}";${loc.valorBase.toFixed(2)};${loc.multa.toFixed(2)};${loc.valorTotal.toFixed(2)};"${loc.status}";"${loc.usuarioOperador}"\n`;
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${nomeArquivo}`);
    res.send("\uFEFF" + csv);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao exportar planilha de faturamento." });
  }
});

app.get("/api/relatorios/exportar/frota", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const resumo = await db.obterResumoGeral("todos");
    let csv = "ID;Código;Modelo;Ponto de Distribuição;Bateria (%);Status Atual;Total de Locações;Faturamento Gerado (R$);Gasto com Manutenção (R$);Lucro Líquido (R$)\n";

    resumo.usoPorPatinete.forEach(p => {
      csv += `${p.id};"${p.codigo}";"${p.modelo}";"${p.pontoNome}";${p.bateria};"${p.status}";${p.totalLocacoes};${p.faturamentoGerado.toFixed(2)};${p.gastoManutencao.toFixed(2)};${p.lucroLiquido.toFixed(2)}\n`;
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=relatorio-frota.csv");
    res.send("\uFEFF" + csv);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao exportar planilha da frota." });
  }
});

app.get("/api/relatorios/exportar/pontos", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const pontos = await db.listarPontos();
    let csv = "ID;Nome do Ponto;Localização / Endereço;Total Patinetes;Patinetes Livres;Patinetes Alugados;Em Manutenção;Data de Cadastro\n";

    pontos.forEach(p => {
      const dataFormatada = p.criadoEm ? new Date(p.criadoEm).toLocaleDateString("pt-BR") : "";
      csv += `${p.id};"${p.nome}";"${p.localizacao}";${p.total};${p.livres};${p.alugados};${p.manutencao};"${dataFormatada}"\n`;
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=pontos-distribuicao.csv");
    res.send("\uFEFF" + csv);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao exportar planilha de pontos." });
  }
});

// ==========================================
// 7. ROTAS DE ADMINISTRAÇÃO E PAINEL
// ==========================================

app.get("/api/admin/stats", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { mes } = req.query;
    const resumo = await db.obterResumoGeral(mes || null);
    const config = await db.obterConfig();

    res.json({
      periodo: resumo.periodo,
      mesAtual: resumo.mesAtual,
      perfil: {
        nome: config.nomeAdmin,
        cargo: config.cargoAdmin
      },
      stats: {
        totalPatinetes: resumo.frota.total,
        totalLocacoes: resumo.financeiro.totalLocacoes,
        totalManutencao: resumo.financeiro.gastoManutencaoTotal,
        faturamentoTotal: resumo.financeiro.faturamentoTotal,
        saldo: resumo.financeiro.lucroTotal,
        faturamentoHistorico: resumo.financeiro.faturamentoHistorico,
        locacoesHistorico: resumo.financeiro.locacoesHistorico
      },
      configuracoes: config
    });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao obter dados administrativos." });
  }
});

app.get("/api/admin/central", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.obterPainelOperacional());
  } catch (error) {
    res.status(500).json({ erro: "Erro ao montar a central administrativa." });
  }
});

app.put("/api/admin/configuracoes", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const tempos = Array.isArray(req.body.temposDisponiveis)
      ? [...new Set(req.body.temposDisponiveis.map(Number).filter(valor => Number.isInteger(valor) && valor > 0 && valor <= 1440))].sort((a, b) => a - b)
      : [];
    if (!tempos.length) return res.status(400).json({ erro: "Informe ao menos um tempo de locação válido." });
    const precos = {};
    tempos.forEach(tempo => {
      const preco = Number(req.body.precos?.[tempo]);
      if (!Number.isFinite(preco) || preco <= 0) throw new Error(`Preço inválido para ${tempo} minutos.`);
      precos[tempo] = preco;
    });
    const configuracoes = await db.salvarConfig({
      nomeEmpresa: validarTexto(req.body.nomeEmpresa, "Nome da empresa", 100),
      temposDisponiveis: tempos,
      precos,
      multaPorMinuto: Math.max(0, Number(req.body.multaPorMinuto) || 0),
      limitePatinetesLocacao: Math.min(20, Math.max(1, parseInt(req.body.limitePatinetesLocacao) || 1))
    });
    res.json({ mensagem: "Configurações atualizadas com sucesso.", configuracoes });
  } catch (error) {
    res.status(400).json({ erro: error.message });
  }
});

// Rota raiz
app.get("/", (req, res) => {
  res.sendFile(path.join(pastaPublica, "login.html"));
});

// Inicia Servidor
app.listen(PORT, () => {
  console.log("==========================================");
  console.log("Back-end E-Scooter GO Rodando");
  console.log(`URL: http://localhost:${PORT}`);
  console.log("==========================================");
});
