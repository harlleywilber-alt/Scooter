// E-Scooter GO - Servidor HTTP: API REST + arquivos do front-end (public/)
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const db = require("./database");
const conexao = require("./conexao");
const { gerarPlanilhaRelatorio } = require("./exportacao");
const { FORMAS_PAGAMENTO } = require("./inicializacao");

// ==========================================
// CONFIGURAÇÃO
// ==========================================

const app = express();
const PORT = process.env.PORT || 3000;
const pastaPublica = path.resolve(__dirname, "..", "public");

const DURACAO_TOKEN_MS = 8 * 60 * 60 * 1000;
const JANELA_LOGIN_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS_LOGIN = 20;
const SENHA_MINIMA = 6;
const MAX_PATINETES_POR_CADASTRO = 100;

app.use(cors());
app.use(express.json());
app.use(express.static(pastaPublica));

// Segredo das sessões: variável AUTH_SECRET ou arquivo local server/.auth-secret
function obterSegredoAuth() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const arquivo = path.join(__dirname, ".auth-secret");
  try {
    const salvo = fs.readFileSync(arquivo, "utf8").trim();
    if (salvo.length >= 32) return salvo;
  } catch {}
  const novo = crypto.randomBytes(48).toString("hex");
  try {
    fs.writeFileSync(arquivo, novo, { mode: 0o600 });
  } catch (error) {
    console.warn("[AVISO] Não foi possível salvar server/.auth-secret:", error.message);
  }
  return novo;
}
const AUTH_SECRET = obterSegredoAuth();

// ==========================================
// AUTENTICAÇÃO E PERMISSÕES
// ==========================================

// IP real do usuário. Atrás do Cloudflare Tunnel toda conexão chega de
// 127.0.0.1; nesse caso o IP original vem no cabeçalho CF-Connecting-IP.
function ipDoCliente(req) {
  const origem = req.socket.remoteAddress || "";
  const conexaoLocal = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(origem);
  return (conexaoLocal && req.headers["cf-connecting-ip"]) || req.ip || origem || "desconhecido";
}

const tentativasLogin = new Map();

function limitarLogin(req, res, next) {
  const agora = Date.now();
  if (tentativasLogin.size > 5000) {
    for (const [ip, registro] of tentativasLogin) {
      if (agora - registro.inicio > JANELA_LOGIN_MS) tentativasLogin.delete(ip);
    }
  }
  const chave = ipDoCliente(req);
  const registro = tentativasLogin.get(chave) || { quantidade: 0, inicio: agora };
  if (agora - registro.inicio > JANELA_LOGIN_MS) {
    registro.quantidade = 0;
    registro.inicio = agora;
  }
  registro.quantidade += 1;
  tentativasLogin.set(chave, registro);
  if (registro.quantidade > MAX_TENTATIVAS_LOGIN) {
    return res.status(429).json({ erro: "Muitas tentativas de login. Aguarde alguns minutos." });
  }
  next();
}

// Token = dados do usuário em base64 + assinatura HMAC-SHA256
function assinarToken(usuario) {
  const payload = Buffer.from(JSON.stringify({
    id: usuario.id,
    usuario: usuario.usuario,
    nome: usuario.nome,
    nivel: usuario.nivel || "operador",
    exp: Date.now() + DURACAO_TOKEN_MS
  })).toString("base64url");
  const assinatura = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${assinatura}`;
}

async function autenticarRequisicao(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const [payload, assinatura] = token.split(".");
  if (!payload || !assinatura) return res.status(401).json({ erro: "Autenticação necessária." });

  const esperada = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  const assinaturaValida = assinatura.length === esperada.length
    && crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada));
  if (!assinaturaValida) return res.status(401).json({ erro: "Sessão inválida." });

  try {
    const usuario = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!usuario.exp || usuario.exp < Date.now()) return res.status(401).json({ erro: "Sessão expirada." });

    // Confere no banco a cada requisição: bloqueio e recusa valem na hora
    const usuarioAtual = await db.obterUsuarioSessao(usuario.id);
    if (!usuarioAtual || usuarioAtual.status !== "aprovado" || usuarioAtual.bloqueado) {
      return res.status(401).json({ erro: "Conta sem acesso ao sistema." });
    }
    req.usuario = { ...usuario, ...usuarioAtual };
    await db.registrarAtividadeUsuario(usuarioAtual.id);
    next();
  } catch (error) {
    if (error.bancoIndisponivel) return res.status(503).json({ erro: error.message });
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

function patineteForaDoPonto(req, patinete) {
  return req.usuario.nivel === "operador" && (!req.usuario.pontoId || patinete?.pontoId !== req.usuario.pontoId);
}

// ==========================================
// VALIDAÇÃO E RESPOSTAS
// ==========================================

// 503 = banco fora do ar; 500 = erro interno; demais = status informado
function falhar(res, error, status = 400, mensagem = error.message) {
  if (error && error.bancoIndisponivel) return res.status(503).json({ erro: error.message });
  if (error && error.erroInterno) return res.status(500).json({ erro: error.message });
  return res.status(status).json({ erro: mensagem });
}

function validarTexto(valor, campo, maximo = 120) {
  const texto = String(valor || "").trim();
  if (!texto) throw new Error(`${campo} é obrigatório.`);
  if (texto.length > maximo) throw new Error(`${campo} excede o limite de ${maximo} caracteres.`);
  if (/[<>]/.test(texto)) throw new Error(`${campo} contém caracteres não permitidos.`);
  return texto;
}

function validarTelefone(valor) {
  const telefone = String(valor ?? "").trim();
  const digitos = telefone.replace(/\D/g, "");
  if (!/^[0-9()+\-\s]*$/.test(telefone) || digitos.length < 10 || digitos.length > 13) {
    throw new Error("Informe um telefone válido com DDD.");
  }
  return telefone;
}

// Campo de CSV: escapa aspas e neutraliza fórmulas (=, +, -, @) para o Excel
function csv(valor) {
  let texto = String(valor ?? "");
  if (/^[=+\-@\t\r]/.test(texto)) texto = "'" + texto;
  return `"${texto.replace(/"/g, '""')}"`;
}
const numeroCsv = valor => (Number(valor) || 0).toFixed(2);

function enviarCsv(res, nomeArquivo, conteudo) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
  res.send("﻿" + conteudo);
}

// ==========================================
// 1. AUTENTICAÇÃO E USUÁRIOS
// ==========================================

app.post("/api/auth/cadastro", async (req, res) => {
  try {
    const { nome, usuario, senha } = req.body || {};
    if (!nome || !usuario || !senha || typeof usuario !== "string" || typeof senha !== "string") {
      return res.status(400).json({ erro: "Preencha todos os campos obrigatórios." });
    }
    if (usuario.length < 3) {
      return res.status(400).json({ erro: "O nome de usuário deve ter pelo menos 3 caracteres." });
    }
    if (senha.length < SENHA_MINIMA || senha.length > 128) {
      return res.status(400).json({ erro: `A senha deve ter entre ${SENHA_MINIMA} e 128 caracteres.` });
    }
    if (usuario.length > 40 || !/^[a-zA-Z0-9._-]+$/.test(usuario)) {
      return res.status(400).json({ erro: "O usuário deve conter apenas letras, números, ponto, hífen ou sublinhado." });
    }

    const novoUsuario = await db.cadastrarUsuario(validarTexto(nome, "Nome", 100), usuario.trim(), senha);
    res.status(201).json({
      mensagem: "Cadastro realizado com sucesso! Aguarde a aprovação do administrador para acessar o sistema.",
      usuario: novoUsuario
    });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.post("/api/auth/login", limitarLogin, async (req, res) => {
  try {
    const { usuario, senha } = req.body || {};
    if (!usuario || !senha || typeof usuario !== "string" || typeof senha !== "string" || senha.length > 128) {
      return res.status(400).json({ erro: "Informe usuário e senha." });
    }

    const resultado = await db.autenticarUsuario(usuario, senha);
    if (resultado.erro) return res.status(401).json({ erro: resultado.erro });

    tentativasLogin.delete(ipDoCliente(req));
    res.json({
      mensagem: "Login realizado com sucesso!",
      usuario: resultado.usuario,
      token: assinarToken(resultado.usuario),
      expiraEm: new Date(Date.now() + DURACAO_TOKEN_MS).toISOString()
    });
  } catch (error) {
    falhar(res, error, 500, "Erro interno no servidor de autenticação.");
  }
});

app.get("/api/admin/usuarios", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.listarUsuarios());
  } catch (error) {
    falhar(res, error, 500, "Erro ao listar usuários.");
  }
});

app.put("/api/admin/usuarios/:id/status", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (status !== "aprovado" && status !== "recusado") {
      return res.status(400).json({ erro: "Status inválido. Use 'aprovado' ou 'recusado'." });
    }
    const usuario = await db.alterarStatusUsuario(req.params.id, status, req.usuario.usuario);
    res.json({ mensagem: `Status do usuário atualizado para '${status}' com sucesso!`, usuario });
  } catch (error) {
    falhar(res, error, 400);
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
    falhar(res, error, 400);
  }
});

app.put("/api/admin/usuarios/:id/ponto", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const usuario = await db.alterarPontoUsuario(req.params.id, req.body.pontoId, req.usuario.usuario);
    res.json({ mensagem: "Ponto de trabalho atualizado com sucesso!", usuario });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.put("/api/admin/usuarios/:id/bloqueio", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const usuario = await db.alterarBloqueioUsuario(req.params.id, Boolean(req.body.bloqueado), req.usuario.usuario);
    res.json({ mensagem: usuario.bloqueado ? "Operador bloqueado temporariamente." : "Operador desbloqueado.", usuario });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.delete("/api/admin/usuarios/:id", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const usuario = await db.excluirUsuarioRecusado(req.params.id, req.usuario.usuario);
    res.json({ mensagem: "Cadastro recusado excluído com sucesso!", usuario });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.get("/api/admin/historico-usuarios", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.listarHistoricoUsuarios());
  } catch (error) {
    falhar(res, error, 500, "Erro ao listar o histórico de usuários.");
  }
});

// ==========================================
// 2. PONTOS DE DISTRIBUIÇÃO
// ==========================================

app.get("/api/pontos", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.listarPontos());
  } catch (error) {
    falhar(res, error, 500, "Erro ao listar pontos de distribuição.");
  }
});

app.post("/api/pontos", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { nome, localizacao } = req.body;
    const ponto = await db.adicionarPonto(
      validarTexto(nome, "Nome", 100),
      validarTexto(localizacao || "Sem localização", "Localização", 180)
    );
    res.status(201).json({ mensagem: `Ponto '${ponto.nome}' cadastrado com sucesso!`, ponto });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.delete("/api/pontos/:id", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const ponto = await db.removerPonto(req.params.id);
    res.json({ mensagem: `Ponto '${ponto.nome}' removido com sucesso!`, ponto });
  } catch (error) {
    falhar(res, error, 400);
  }
});

// ==========================================
// 3. PATINETES (FROTA)
// ==========================================

app.get("/api/patinetes", autenticarRequisicao, async (req, res) => {
  try {
    // Operador vê só os patinetes do seu ponto de trabalho
    const ehOperador = req.usuario.nivel === "operador";
    if (ehOperador && !req.usuario.pontoId) return res.json([]);
    res.json(await db.listarPatinetes(ehOperador ? req.usuario.pontoId : null));
  } catch (error) {
    falhar(res, error, 500, "Erro ao listar patinetes.");
  }
});

app.get("/api/patinetes/:id/historico", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.obterHistoricoPatinete(req.params.id));
  } catch (error) {
    falhar(res, error, 404);
  }
});

app.post("/api/patinetes", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { quantidade, pontoId } = req.body;
    const qtd = quantidade === undefined || quantidade === "" ? 1 : Number(quantidade);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > MAX_PATINETES_POR_CADASTRO) {
      return res.status(400).json({ erro: `Informe uma quantidade inteira entre 1 e ${MAX_PATINETES_POR_CADASTRO}.` });
    }
    const patinetes = await db.adicionarPatinetes(qtd, pontoId);
    res.status(201).json({ mensagem: `${qtd} patinete(s) adicionado(s) à frota com sucesso!`, patinetes });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.put("/api/patinetes/:id", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const patinete = await db.atualizarPatinete(req.params.id, req.body);
    res.json({ mensagem: "Patinete atualizado com sucesso!", patinete });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.post("/api/patinetes/remover", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ erro: "Selecione pelo menos um patinete." });
    if (ids.length > 500) return res.status(400).json({ erro: "Selecione no máximo 500 patinetes por vez." });
    const patinetes = await db.removerPatinetes(ids);
    const mensagem = patinetes.length === 1
      ? `Patinete ${patinetes[0].codigo} removido da frota com sucesso!`
      : `${patinetes.length} patinetes removidos da frota com sucesso!`;
    res.json({ mensagem, patinetes });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.delete("/api/patinetes/:id", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const patinete = await db.removerPatinete(req.params.id);
    res.json({ mensagem: `Patinete ${patinete.codigo} removido da frota com sucesso!`, patinete });
  } catch (error) {
    falhar(res, error, 400);
  }
});

// ==========================================
// 4. CLIENTES E LOCAÇÕES
// ==========================================

app.get("/api/clientes", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.listarClientes());
  } catch (error) {
    falhar(res, error, 500, "Erro ao listar clientes.");
  }
});

app.get("/api/clientes/:id/historico", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.obterHistoricoCliente(req.params.id));
  } catch (error) {
    falhar(res, error, 404);
  }
});

app.get("/api/locacoes", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.listarLocacoes());
  } catch (error) {
    falhar(res, error, 500, "Erro ao listar locações.");
  }
});

app.post("/api/locacoes/iniciar", autenticarRequisicao, somenteOperacao, async (req, res) => {
  try {
    const { patineteId, patineteIds, cliente, telefone, tempo, pagamento } = req.body;
    const ids = Array.isArray(patineteIds) ? patineteIds : [patineteId];
    const config = await db.obterConfig();

    if (!ids.length || ids.some(id => !id) || !cliente || !tempo || !pagamento) {
      return res.status(400).json({ erro: "Campos obrigatórios ausentes para iniciar a locação." });
    }
    if (!FORMAS_PAGAMENTO.includes(pagamento)) {
      return res.status(400).json({ erro: "Forma de pagamento inválida." });
    }
    const telefoneValidado = validarTelefone(telefone);
    if (ids.length > Number(config.limitePatinetesLocacao || 5)) {
      return res.status(400).json({ erro: `O limite é de ${config.limitePatinetesLocacao || 5} patinetes por locação.` });
    }
    if (!config.temposDisponiveis.map(Number).includes(Number(tempo))) {
      return res.status(400).json({ erro: "Tempo de locação não permitido nas configurações." });
    }

    // O preço vem sempre da configuração, nunca do navegador
    const valorBase = Number(config.precos[String(tempo)]);
    if (!Number.isFinite(valorBase) || valorBase <= 0) {
      return res.status(400).json({ erro: "Preço não configurado para o tempo selecionado." });
    }

    const solicitados = await Promise.all(ids.map(id => db.buscarPatinetePorId(id)));
    if (solicitados.some(patinete => patineteForaDoPonto(req, patinete))) {
      return res.status(403).json({ erro: "Este patinete não pertence ao seu ponto de trabalho." });
    }

    const { patinetes, locacoes } = await db.iniciarLocacoes(
      ids, validarTexto(cliente, "Cliente", 100), telefoneValidado, tempo, valorBase, pagamento, req.usuario.usuario
    );
    res.status(201).json({
      mensagem: `${patinetes.length} locação(ões) iniciada(s) com sucesso!`,
      locacoes,
      patinetes,
      locacao: locacoes[0],
      patinete: patinetes[0]
    });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.post("/api/locacoes/finalizar", autenticarRequisicao, somenteOperacao, async (req, res) => {
  try {
    // A multa é calculada no servidor; valores enviados pelo navegador são ignorados
    const { patineteId } = req.body;
    if (!patineteId) return res.status(400).json({ erro: "ID do patinete é obrigatório." });

    const solicitado = await db.buscarPatinetePorId(patineteId);
    if (!solicitado) return res.status(404).json({ erro: "Patinete não encontrado." });
    if (patineteForaDoPonto(req, solicitado)) {
      return res.status(403).json({ erro: "Este patinete não pertence ao seu ponto de trabalho." });
    }

    const { patinete, locacao } = await db.finalizarLocacao(patineteId);
    res.json({ mensagem: `Patinete ${patinete.codigo} devolvido com sucesso!`, patinete, locacao });
  } catch (error) {
    falhar(res, error, 400);
  }
});

// ==========================================
// 5. MANUTENÇÕES
// ==========================================

app.get("/api/manutencoes", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.listarManutencoes());
  } catch (error) {
    falhar(res, error, 500, "Erro ao listar manutenções.");
  }
});

app.post("/api/manutencoes", autenticarRequisicao, somenteOperacao, async (req, res) => {
  try {
    const { patineteId, descricao, valor } = req.body;
    if (!patineteId || !descricao) {
      return res.status(400).json({ erro: "Patinete e descrição são obrigatórios." });
    }
    const valorNumerico = Number(valor);
    if (!Number.isFinite(valorNumerico) || valorNumerico < 0 || valorNumerico > 100000) {
      return res.status(400).json({ erro: "Valor da manutenção inválido. Informe um valor entre R$ 0,00 e R$ 100.000,00." });
    }

    const solicitado = await db.buscarPatinetePorId(patineteId);
    if (patineteForaDoPonto(req, solicitado)) {
      return res.status(403).json({ erro: "Este patinete não pertence ao seu ponto de trabalho." });
    }

    // Só o administrador informa custo; o operador registra apenas o problema
    const valorPermitido = req.usuario.nivel === "administrador" ? valorNumerico : 0;
    const { patinete, manutencao } = await db.registrarManutencao(
      patineteId, validarTexto(descricao, "Descrição", 300), valorPermitido, req.usuario.usuario
    );
    res.status(201).json({ mensagem: `Patinete ${patinete.codigo} enviado para manutenção com sucesso!`, patinete, manutencao });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.post("/api/manutencoes/liberar", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const patinete = await db.liberarManutencao(req.body.patineteId);
    res.json({ mensagem: `Patinete ${patinete.codigo} revisado, 100% carregado e liberado para a frota!`, patinete });
  } catch (error) {
    falhar(res, error, 400);
  }
});

app.put("/api/admin/manutencoes/:id", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const manutencao = await db.atualizarManutencao(req.params.id, req.body || {});
    const mensagem = manutencao.status === "concluida" ? "Manutenção concluída e patinete liberado." : "Manutenção atualizada.";
    res.json({ mensagem, manutencao });
  } catch (error) {
    falhar(res, error, 400);
  }
});

// ==========================================
// 6. RELATÓRIOS E EXPORTAÇÃO (CSV)
// ==========================================

// Período: ?mes=atual|anterior|todos|AAAA-MM  ou  ?inicio=AAAA-MM-DD&fim=AAAA-MM-DD
app.get("/api/relatorios/resumo", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { mes, inicio, fim } = req.query;
    const filtro = inicio || fim ? { inicio, fim } : (mes || null);
    res.json(await db.obterResumoGeral(filtro));
  } catch (error) {
    if (error.erroDeValidacao) return falhar(res, error, 400);
    falhar(res, error, 500, "Erro ao consolidar resumo dos relatórios.");
  }
});

// Planilha Excel (.xlsx) com abas Resumo, Locações, Manutenções e Frota; mesmo filtro de período do resumo
app.get("/api/relatorios/exportar/excel", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { mes, inicio, fim } = req.query;
    const filtro = inicio || fim ? { inicio, fim } : (mes || null);
    const { buffer, nomeArquivo } = await gerarPlanilhaRelatorio(filtro);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    if (error.erroDeValidacao) return falhar(res, error, 400);
    falhar(res, error, 500, "Erro ao gerar a planilha Excel.");
  }
});

app.get("/api/relatorios/exportar/faturamento", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const { periodo, mes } = req.query;
    const mesAtual = db.mesLocal(new Date());
    let locacoes = await db.listarLocacoes();
    let nomeArquivo = "faturamento-historico-completo.csv";

    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
      locacoes = locacoes.filter(l => db.mesLocal(l.dataInicio) === mes);
      nomeArquivo = `faturamento-${mes}.csv`;
    } else if (periodo === "mes_atual") {
      locacoes = locacoes.filter(l => db.mesLocal(l.dataInicio) === mesAtual);
      nomeArquivo = `faturamento-${mesAtual}.csv`;
    }

    let conteudo = "ID;Data;Patinete;Ponto;Cliente;Telefone;Tempo (min);Forma de Pagamento;Valor Base (R$);Multa (R$);Valor Total (R$);Status;Operador\n";
    locacoes.forEach(l => {
      const data = l.dataInicio ? new Date(l.dataInicio).toLocaleString("pt-BR") : "";
      conteudo += [
        l.id, csv(data), csv(l.patineteCodigo), csv(l.pontoNome || "Geral"), csv(l.cliente), csv(l.telefone),
        Number(l.tempoMinutos) || 0, csv(l.pagamento), numeroCsv(l.valorBase), numeroCsv(l.multa),
        numeroCsv(l.valorTotal), csv(l.status), csv(l.usuarioOperador)
      ].join(";") + "\n";
    });
    enviarCsv(res, nomeArquivo, conteudo);
  } catch (error) {
    falhar(res, error, 500, "Erro ao exportar planilha de faturamento.");
  }
});

app.get("/api/relatorios/exportar/frota", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const resumo = await db.obterResumoGeral("todos");
    let conteudo = "ID;Código;Modelo;Ponto de Distribuição;Bateria (%);Status Atual;Total de Locações;Faturamento Gerado (R$);Gasto com Manutenção (R$);Lucro Líquido (R$)\n";
    resumo.usoPorPatinete.forEach(p => {
      conteudo += [
        p.id, csv(p.codigo), csv(p.modelo), csv(p.pontoNome), Number(p.bateria) || 0, csv(p.status),
        p.totalLocacoes, numeroCsv(p.faturamentoGerado), numeroCsv(p.gastoManutencao), numeroCsv(p.lucroLiquido)
      ].join(";") + "\n";
    });
    enviarCsv(res, "relatorio-frota.csv", conteudo);
  } catch (error) {
    falhar(res, error, 500, "Erro ao exportar planilha da frota.");
  }
});

app.get("/api/relatorios/exportar/pontos", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const pontos = await db.listarPontos();
    let conteudo = "ID;Nome do Ponto;Localização / Endereço;Total Patinetes;Patinetes Livres;Patinetes Alugados;Em Manutenção;Data de Cadastro\n";
    pontos.forEach(p => {
      const data = p.criadoEm ? new Date(p.criadoEm).toLocaleDateString("pt-BR") : "";
      conteudo += [
        p.id, csv(p.nome), csv(p.localizacao), p.total, p.livres, p.alugados, p.manutencao, csv(data)
      ].join(";") + "\n";
    });
    enviarCsv(res, "pontos-distribuicao.csv", conteudo);
  } catch (error) {
    falhar(res, error, 500, "Erro ao exportar planilha de pontos.");
  }
});

// ==========================================
// 7. PAINEL ADMINISTRATIVO E CONFIGURAÇÕES
// ==========================================

app.get("/api/admin/stats", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const resumo = await db.obterResumoGeral(req.query.mes || null);
    const config = await db.obterConfig();
    res.json({
      periodo: resumo.periodo,
      mesAtual: resumo.mesAtual,
      perfil: { nome: config.nomeAdmin, cargo: config.cargoAdmin },
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
    falhar(res, error, 500, "Erro ao obter dados administrativos.");
  }
});

app.get("/api/admin/central", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    res.json(await db.obterPainelOperacional());
  } catch (error) {
    falhar(res, error, 500, "Erro ao montar a central administrativa.");
  }
});

app.get("/api/configuracoes", autenticarRequisicao, async (req, res) => {
  try {
    res.json(await db.obterConfig());
  } catch (error) {
    falhar(res, error, 500, "Erro ao carregar configurações.");
  }
});

app.put("/api/admin/configuracoes", autenticarRequisicao, somenteAdmin, async (req, res) => {
  try {
    const tempos = Array.isArray(req.body.temposDisponiveis)
      ? [...new Set(req.body.temposDisponiveis.map(Number).filter(t => Number.isInteger(t) && t > 0 && t <= 1440))].sort((a, b) => a - b)
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
    falhar(res, error, 400);
  }
});

// ==========================================
// INICIALIZAÇÃO
// ==========================================

app.get("/", (req, res) => {
  res.sendFile(path.join(pastaPublica, "login.html"));
});

const servidor = app.listen(PORT, () => {
  console.log("==========================================");
  console.log("Back-end E-Scooter GO Rodando");
  console.log(`URL: http://localhost:${PORT}`);
  console.log("==========================================");
  // Se o banco estiver fora do ar, o servidor continua no ar e tenta de novo depois
  conexao.garantirInicializado()
    .then(() => console.log("[banco] PostgreSQL conectado e esquema verificado."))
    .catch(error => console.error("[banco] Não foi possível inicializar o banco agora:", error.message));
});

function encerrar(sinal) {
  console.log(`${sinal} recebido, encerrando...`);
  servidor.close(() => conexao.encerrar().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGINT", () => encerrar("SIGINT"));
process.on("SIGTERM", () => encerrar("SIGTERM"));
