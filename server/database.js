const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Caminho do arquivo de banco de dados
const dataDir = path.resolve(__dirname, "..", "data");
const dbPath = path.join(dataDir, "database.json");

// Garante que o diretório 'data' existe
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Funções de Criptografia Segura (Hash com Salt via PBKDF2)
function gerarSalt() {
  return crypto.randomBytes(16).toString("hex");
}

const ITERACOES_SENHA = 120000;
const CONFIG_PADRAO = {
  nomeAdmin: "Administrador Geral",
  cargoAdmin: "Gestor do Sistema",
  nomeEmpresa: "E-Scooter Go",
  precos: { 15: 20, 30: 30, 45: 45 },
  temposDisponiveis: [15, 30, 45],
  multaPorMinuto: 1,
  limitePatinetesLocacao: 5,
  alertaManutencaoDias: 3
};

function hashSenha(senha, salt, iteracoes = ITERACOES_SENHA) {
  return crypto.pbkdf2Sync(senha, salt, iteracoes, 64, "sha512").toString("hex");
}

function verificarSenha(senhaDigitada, hashArmazenado, salt, iteracoes = ITERACOES_SENHA) {
  const hashTeste = hashSenha(senhaDigitada, salt, iteracoes);
  return hashTeste.length === hashArmazenado.length && crypto.timingSafeEqual(Buffer.from(hashTeste), Buffer.from(hashArmazenado));
}

// Estrutura inicial do Banco de Dados
function obterEstadoInicial() {
  const saltAdmin = gerarSalt();
  const senhaHashAdmin = hashSenha("admin123", saltAdmin);

  return {
    usuarios: [
      {
        id: 1,
        nome: "Administrador Geral",
        usuario: "admin",
        senhaHash: senhaHashAdmin,
        salt: saltAdmin,
        iteracoesSenha: ITERACOES_SENHA,
        cargo: "Gestor do Sistema",
        nivel: "administrador",
        status: "aprovado",
        criadoEm: new Date().toISOString()
      }
    ],
    pontos: [
      {
        id: 1,
        nome: "Uni goias",
        localizacao: "-16.691576, -49.310984",
        criadoEm: new Date().toISOString()
      },
      {
        id: 2,
        nome: "Hidrolandia",
        localizacao: "Praça lago",
        criadoEm: new Date().toISOString()
      },
      {
        id: 3,
        nome: "Teste",
        localizacao: "Sem localização",
        criadoEm: new Date().toISOString()
      }
    ],
    patinetes: [
      { id: 1, codigo: "PAT001", modelo: "E-Scooter Pro Max", bateria: 100, status: "livre", pontoId: 2, pontoNome: "Hidrolandia", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null, criadoEm: new Date().toISOString() },
      { id: 2, codigo: "PAT002", modelo: "E-Scooter Pro Max", bateria: 85, status: "livre", pontoId: 2, pontoNome: "Hidrolandia", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null, criadoEm: new Date().toISOString() },
      { id: 3, codigo: "PAT003", modelo: "E-Scooter Urban", bateria: 90, status: "livre", pontoId: 2, pontoNome: "Hidrolandia", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null, criadoEm: new Date().toISOString() },
      { id: 4, codigo: "PAT004", modelo: "E-Scooter Urban", bateria: 70, status: "livre", pontoId: 2, pontoNome: "Hidrolandia", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null, criadoEm: new Date().toISOString() },
      { id: 5, codigo: "PAT005", modelo: "E-Scooter Lite", bateria: 95, status: "livre", pontoId: null, pontoNome: "Sem ponto", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null, criadoEm: new Date().toISOString() },
      { id: 6, codigo: "PAT006", modelo: "E-Scooter Lite", bateria: 100, status: "livre", pontoId: null, pontoNome: "Sem ponto", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null, criadoEm: new Date().toISOString() },
      { id: 7, codigo: "PAT007", modelo: "E-Scooter Lite", bateria: 100, status: "livre", pontoId: 3, pontoNome: "Teste", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null, criadoEm: new Date().toISOString() },
      { id: 8, codigo: "PAT008", modelo: "E-Scooter Urban", bateria: 95, status: "livre", pontoId: 3, pontoNome: "Teste", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null, criadoEm: new Date().toISOString() },
      { id: 9, codigo: "PAT009", modelo: "E-Scooter Pro Max", bateria: 100, status: "livre", pontoId: 3, pontoNome: "Teste", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null, criadoEm: new Date().toISOString() },
      { id: 10, codigo: "PAT010", modelo: "E-Scooter Pro Max", bateria: 100, status: "livre", pontoId: 1, pontoNome: "Uni goias", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null, criadoEm: new Date().toISOString() }
    ],
    locacoes: [],
    manutencoes: [],
    clientes: [],
    historicoUsuarios: [],
    configuracoes: { ...CONFIG_PADRAO, precos: { ...CONFIG_PADRAO.precos } }
  };
}

// Leitura e Escrita Síncrona Segura
function lerDB() {
  try {
    if (!fs.existsSync(dbPath)) {
      const inicial = obterEstadoInicial();
      salvarDB(inicial);
      return inicial;
    }
    const dados = fs.readFileSync(dbPath, "utf-8");
    const db = JSON.parse(dados);

    if (!db.pontos || !Array.isArray(db.pontos)) {
      db.pontos = [
        { id: 1, nome: "Uni goias", localizacao: "-16.691576, -49.310984", criadoEm: new Date().toISOString() },
        { id: 2, nome: "Hidrolandia", localizacao: "Praça lago", criadoEm: new Date().toISOString() },
        { id: 3, nome: "Teste", localizacao: "Sem localização", criadoEm: new Date().toISOString() }
      ];
      salvarDB(db);
    }

    if (!Array.isArray(db.historicoUsuarios)) db.historicoUsuarios = [];
    if (!Array.isArray(db.clientes)) db.clientes = [];
    (db.locacoes || []).forEach(locacao => {
      const telefone = String(locacao.telefone || "").replace(/\D/g, "");
      let cliente = telefone ? db.clientes.find(c => String(c.telefone || "").replace(/\D/g, "") === telefone) : null;
      if (!cliente && locacao.cliente) {
        cliente = { id: db.clientes.length ? Math.max(...db.clientes.map(c => c.id)) + 1 : 1, nome: locacao.cliente, telefone: locacao.telefone || "", criadoEm: locacao.dataInicio };
        db.clientes.push(cliente);
      }
      if (cliente && !locacao.clienteId) locacao.clienteId = cliente.id;
    });
    db.usuarios = (db.usuarios || []).map(u => ({
      ...u,
      nivel: u.usuario === "admin" ? "administrador" : (u.nivel === "administrador" ? "administrador" : "operador"),
      status: u.status || "aprovado"
    }));
    db.configuracoes = {
      ...CONFIG_PADRAO,
      ...(db.configuracoes || {}),
      precos: { ...CONFIG_PADRAO.precos, ...((db.configuracoes || {}).precos || {}) }
    };

    return db;
  } catch (error) {
    console.error("Erro ao ler banco de dados:", error);
    return obterEstadoInicial();
  }
}

function salvarDB(dados) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(dados, null, 2), "utf-8");
    return true;
  } catch (error) {
    console.error("Erro ao salvar banco de dados:", error);
    return false;
  }
}

// --- USUÁRIOS & APROVAÇÃO ---
function listarUsuarios() {
  const db = lerDB();
  return db.usuarios.map(u => ({
    id: u.id,
    nome: u.nome,
    usuario: u.usuario,
    cargo: u.cargo,
    nivel: u.nivel || (u.usuario === "admin" ? "administrador" : "operador"),
    status: u.status || "aprovado",
    criadoEm: u.criadoEm,
    ultimoLogin: u.ultimoLogin || null,
    ultimaAtividade: u.ultimaAtividade || u.ultimoLogin || null,
    bloqueado: Boolean(u.bloqueado),
    pontoId: u.pontoId || null
  }));
}

function buscarUsuarioPorLogin(usuario) {
  const db = lerDB();
  return db.usuarios.find(u => u.usuario.toLowerCase() === usuario.toLowerCase());
}

function obterUsuarioSessao(id) {
  const user = lerDB().usuarios.find(u => u.id === parseInt(id));
  if (!user) return null;
  return {
    id: user.id, nome: user.nome, usuario: user.usuario,
    nivel: user.nivel || (user.usuario === "admin" ? "administrador" : "operador"),
    status: user.status || "aprovado",
    bloqueado: Boolean(user.bloqueado),
    pontoId: user.pontoId || null
  };
}

function cadastrarUsuario(nome, usuario, senha) {
  const db = lerDB();
  if (buscarUsuarioPorLogin(usuario)) {
    throw new Error("Nome de usuário já cadastrado!");
  }

  const salt = gerarSalt();
  const senhaHash = hashSenha(senha, salt);

  const novoUsuario = {
    id: db.usuarios.length ? Math.max(...db.usuarios.map(u => u.id)) + 1 : 1,
    nome: nome.trim(),
    usuario: usuario.trim(),
    senhaHash,
    salt,
    iteracoesSenha: ITERACOES_SENHA,
    cargo: "Operador",
    nivel: "operador",
    pontoId: null,
    status: "pendente",
    criadoEm: new Date().toISOString()
  };

  db.usuarios.push(novoUsuario);
  salvarDB(db);

  return {
    id: novoUsuario.id,
    nome: novoUsuario.nome,
    usuario: novoUsuario.usuario,
    cargo: novoUsuario.cargo,
    status: novoUsuario.status
  };
}

function autenticarUsuario(usuario, senha) {
  const db = lerDB();
  const user = db.usuarios.find(u => u.usuario.toLowerCase() === usuario.toLowerCase());
  if (!user) return { erro: "Usuário ou senha inválidos." };

  const iteracoesAtuais = user.iteracoesSenha || 1000;
  const senhaValida = verificarSenha(senha, user.senhaHash, user.salt, iteracoesAtuais);
  if (!senhaValida) return { erro: "Usuário ou senha inválidos." };

  if (iteracoesAtuais < ITERACOES_SENHA) {
    user.salt = gerarSalt();
    user.senhaHash = hashSenha(senha, user.salt);
    user.iteracoesSenha = ITERACOES_SENHA;
  }

  const statusUser = user.status || "aprovado";
  if (statusUser === "pendente") {
    return { erro: "Sua conta está aguardando aprovação do administrador." };
  }
  if (statusUser === "recusado") {
    return { erro: "Seu cadastro foi recusado pelo administrador." };
  }
  if (user.bloqueado) {
    return { erro: "Seu acesso foi bloqueado temporariamente pelo administrador." };
  }

  user.ultimoLogin = new Date().toISOString();
  user.ultimaAtividade = user.ultimoLogin;
  db.historicoUsuarios = db.historicoUsuarios || [];
  db.historicoUsuarios.unshift({
    id: Date.now(), acao: "login", usuarioId: user.id, usuarioNome: user.nome,
    responsavel: user.usuario, data: user.ultimoLogin
  });
  salvarDB(db);

  return {
    usuario: {
      id: user.id,
      nome: user.nome,
      usuario: user.usuario,
      cargo: user.cargo,
      nivel: user.nivel || (user.usuario === "admin" ? "administrador" : "operador"),
      pontoId: user.pontoId || null,
      status: statusUser
    }
  };
}

function registrarAtividadeUsuario(id) {
  const db = lerDB();
  const user = db.usuarios.find(u => u.id === parseInt(id));
  if (!user) return;
  const agora = Date.now();
  const ultima = new Date(user.ultimaAtividade || 0).getTime();
  if (!Number.isFinite(ultima) || agora - ultima >= 60000) {
    user.ultimaAtividade = new Date(agora).toISOString();
    salvarDB(db);
  }
}

function alterarBloqueioUsuario(id, bloqueado, responsavel = "admin") {
  const db = lerDB();
  const user = db.usuarios.find(u => u.id === parseInt(id));
  if (!user) throw new Error("Usuário não encontrado.");
  if (user.usuario === "admin") throw new Error("O administrador principal não pode ser bloqueado.");
  user.bloqueado = Boolean(bloqueado);
  registrarHistorico(db, user.bloqueado ? "bloqueio temporário" : "desbloqueio", user, responsavel);
  salvarDB(db);
  return { id: user.id, nome: user.nome, bloqueado: user.bloqueado };
}

function registrarHistorico(db, acao, user, responsavel = "admin", detalhes = "") {
  db.historicoUsuarios = db.historicoUsuarios || [];
  db.historicoUsuarios.unshift({
    id: Date.now(), acao, usuarioId: user.id, usuarioNome: user.nome,
    responsavel, detalhes, data: new Date().toISOString()
  });
}

function alterarStatusUsuario(id, novoStatus, responsavel = "admin") {
  const db = lerDB();
  const user = db.usuarios.find(u => u.id === parseInt(id));
  if (!user) throw new Error("Usuário não encontrado.");
  if (user.usuario === "admin") throw new Error("Não é possível alterar a conta do Administrador principal.");
  if (novoStatus === "aprovado" && (user.nivel || "operador") === "operador" && !user.pontoId) {
    throw new Error("Selecione o ponto de trabalho antes de aprovar o operador.");
  }

  user.status = novoStatus;
  registrarHistorico(db, novoStatus === "aprovado" ? "aprovação" : "recusa", user, responsavel);
  salvarDB(db);

  return {
    id: user.id,
    nome: user.nome,
    usuario: user.usuario,
    status: user.status
  };
}

function alterarNivelUsuario(id, nivel, responsavel = "admin") {
  const db = lerDB();
  const user = db.usuarios.find(u => u.id === parseInt(id));
  if (!user) throw new Error("Usuário não encontrado.");
  if (user.usuario === "admin") throw new Error("O nível do administrador principal não pode ser alterado.");
  const nivelAnterior = user.nivel || "operador";
  user.nivel = nivel;
  user.cargo = nivel === "administrador" ? "Administrador" : "Operador";
  registrarHistorico(db, "alteração de nível", user, responsavel, `${nivelAnterior} para ${nivel}`);
  salvarDB(db);
  return { id: user.id, nome: user.nome, usuario: user.usuario, nivel: user.nivel, status: user.status };
}

function alterarPontoUsuario(id, pontoId, responsavel = "admin") {
  const db = lerDB();
  const user = db.usuarios.find(u => u.id === parseInt(id));
  if (!user) throw new Error("Usuário não encontrado.");
  if (user.usuario === "admin") throw new Error("O administrador principal não utiliza ponto operacional.");
  const ponto = pontoId ? db.pontos.find(p => p.id === parseInt(pontoId)) : null;
  if (pontoId && !ponto) throw new Error("Ponto de distribuição não encontrado.");
  const pontoAnterior = user.pontoId || "sem ponto";
  user.pontoId = ponto ? ponto.id : null;
  registrarHistorico(db, "alteração de ponto", user, responsavel, `${pontoAnterior} para ${ponto ? ponto.nome : "sem ponto"}`);
  salvarDB(db);
  return { id: user.id, nome: user.nome, usuario: user.usuario, pontoId: user.pontoId };
}

function excluirUsuarioRecusado(id, responsavel = "admin") {
  const db = lerDB();
  const index = db.usuarios.findIndex(u => u.id === parseInt(id));
  if (index < 0) throw new Error("Usuário não encontrado.");
  const user = db.usuarios[index];
  if (user.status !== "recusado") throw new Error("Somente cadastros recusados podem ser excluídos.");
  registrarHistorico(db, "exclusão", user, responsavel, "Cadastro recusado removido");
  db.usuarios.splice(index, 1);
  salvarDB(db);
  return user;
}

function listarHistoricoUsuarios() {
  const db = lerDB();
  return (db.historicoUsuarios || []).slice(0, 100);
}

// --- PONTOS DE DISTRIBUIÇÃO ---
function listarPontos() {
  const db = lerDB();
  const patinetes = db.patinetes || [];

  return (db.pontos || []).map(ponto => {
    const bikesPonto = patinetes.filter(p => p.pontoId === ponto.id);
    const total = bikesPonto.length;
    const livres = bikesPonto.filter(p => p.status === "livre").length;
    const alugados = bikesPonto.filter(p => p.status === "locado" || p.status === "atrasado").length;
    const manutencao = bikesPonto.filter(p => p.status === "manutencao").length;

    return {
      id: ponto.id,
      nome: ponto.nome,
      localizacao: ponto.localizacao || "Sem localização",
      total,
      livres,
      alugados,
      manutencao,
      criadoEm: ponto.criadoEm
    };
  });
}

function adicionarPonto(nome, localizacao) {
  const db = lerDB();
  if (!db.pontos) db.pontos = [];

  const novoPonto = {
    id: db.pontos.length ? Math.max(...db.pontos.map(p => p.id)) + 1 : 1,
    nome: nome.trim(),
    localizacao: (localizacao || "").trim() || "Sem localização",
    criadoEm: new Date().toISOString()
  };

  db.pontos.push(novoPonto);
  salvarDB(db);

  return {
    ...novoPonto,
    total: 0,
    livres: 0,
    alugados: 0,
    manutencao: 0
  };
}

function removerPonto(id) {
  const db = lerDB();
  const index = (db.pontos || []).findIndex(p => p.id === parseInt(id));
  if (index === -1) throw new Error("Ponto de distribuição não encontrado");

  const removido = db.pontos.splice(index, 1)[0];
  const pontoRestante = db.pontos.length > 0 ? db.pontos[0] : null;

  db.patinetes.forEach(p => {
    if (p.pontoId === parseInt(id)) {
      p.pontoId = pontoRestante ? pontoRestante.id : null;
      p.pontoNome = pontoRestante ? pontoRestante.nome : "Sem ponto";
    }
  });
  db.usuarios.forEach(usuario => {
    if (usuario.pontoId === parseInt(id)) usuario.pontoId = null;
  });

  salvarDB(db);
  return removido;
}

// --- PATINETES ---
function listarPatinetes(pontoId = null) {
  const db = lerDB();
  return pontoId ? db.patinetes.filter(p => p.pontoId === parseInt(pontoId)) : db.patinetes;
}

function buscarPatinetePorId(id) {
  const db = lerDB();
  return db.patinetes.find(p => p.id === parseInt(id));
}

function adicionarPatinetes(qtd, pontoId = null) {
  const db = lerDB();
  const ultimoId = db.patinetes.length ? Math.max(...db.patinetes.map(p => p.id)) : 0;
  const novos = [];

  let pId = pontoId ? parseInt(pontoId) : (db.pontos && db.pontos.length ? db.pontos[0].id : 1);
  let pNome = "Ponto Central";
  const pontoEncontrado = (db.pontos || []).find(p => p.id === pId);
  if (pontoEncontrado) pNome = pontoEncontrado.nome;

  for (let i = 1; i <= qtd; i++) {
    const novoId = ultimoId + i;
    const patinete = {
      id: novoId,
      codigo: `PAT${String(novoId).padStart(3, "0")}`,
      modelo: "E-Scooter Pro Max",
      bateria: 100,
      status: "livre",
      pontoId: pId,
      pontoNome: pNome,
      cliente: "",
      telefone: "",
      pagamento: "",
      tempo: 0,
      valorBase: 0,
      inicio: null,
      criadoEm: new Date().toISOString()
    };
    db.patinetes.push(patinete);
    novos.push(patinete);
  }

  salvarDB(db);
  return novos;
}

function removerPatinete(id) {
  const db = lerDB();
  const index = db.patinetes.findIndex(p => p.id === parseInt(id));
  if (index === -1) throw new Error("Patinete não encontrado");

  if (db.patinetes[index].status === "locado") {
    throw new Error("Não é possível remover um patinete que está alugado no momento!");
  }

  const removido = db.patinetes.splice(index, 1)[0];
  salvarDB(db);
  return removido;
}

function atualizarPatinete(id, dados) {
  const db = lerDB();
  const index = db.patinetes.findIndex(p => p.id === parseInt(id));
  if (index === -1) throw new Error("Patinete não encontrado");

  if (Object.prototype.hasOwnProperty.call(dados, "pontoId")) {
    if (dados.pontoId) {
      const ponto = (db.pontos || []).find(p => p.id === parseInt(dados.pontoId));
      if (!ponto) throw new Error("Ponto de distribuição não encontrado");
      dados.pontoId = ponto.id;
      dados.pontoNome = ponto.nome;
    } else {
      dados.pontoId = null;
      dados.pontoNome = "Sem ponto";
    }
  }

  db.patinetes[index] = { ...db.patinetes[index], ...dados };
  salvarDB(db);
  return db.patinetes[index];
}

// --- LOCAÇÕES ---
function listarLocacoes() {
  const db = lerDB();
  return db.locacoes;
}

function normalizarTelefone(telefone = "") {
  return String(telefone).replace(/\D/g, "");
}

function obterOuCriarCliente(db, nome, telefone) {
  const telefoneNormalizado = normalizarTelefone(telefone);
  let cliente = telefoneNormalizado
    ? db.clientes.find(c => normalizarTelefone(c.telefone) === telefoneNormalizado)
    : db.clientes.find(c => c.nome.toLowerCase() === nome.trim().toLowerCase());
  if (!cliente) {
    cliente = {
      id: db.clientes.length ? Math.max(...db.clientes.map(c => c.id)) + 1 : 1,
      nome: nome.trim(), telefone: telefone.trim(), criadoEm: new Date().toISOString()
    };
    db.clientes.push(cliente);
  } else {
    cliente.nome = nome.trim();
    if (telefone) cliente.telefone = telefone.trim();
  }
  return cliente;
}

function listarClientes() {
  const db = lerDB();
  return db.clientes.map(cliente => {
    const telefone = normalizarTelefone(cliente.telefone);
    const locacoes = db.locacoes.filter(locacao => locacao.clienteId === cliente.id ||
      (!locacao.clienteId && telefone && normalizarTelefone(locacao.telefone) === telefone));
    const ordenadas = [...locacoes].sort((a, b) => new Date(b.dataInicio) - new Date(a.dataInicio));
    return {
      ...cliente,
      totalLocacoes: locacoes.length,
      totalGasto: locacoes.reduce((total, locacao) => total + (Number(locacao.valorTotal) || 0), 0),
      ultimaLocacao: ordenadas[0]?.dataInicio || null
    };
  });
}

function obterHistoricoCliente(id) {
  const db = lerDB();
  const cliente = db.clientes.find(c => c.id === parseInt(id));
  if (!cliente) throw new Error("Cliente não encontrado.");
  const telefone = normalizarTelefone(cliente.telefone);
  const locacoes = db.locacoes.filter(locacao => locacao.clienteId === cliente.id ||
    (!locacao.clienteId && telefone && normalizarTelefone(locacao.telefone) === telefone));
  return { cliente, locacoes: locacoes.sort((a, b) => new Date(b.dataInicio) - new Date(a.dataInicio)) };
}

function obterHistoricoPatinete(id) {
  const db = lerDB();
  const patinete = db.patinetes.find(p => p.id === parseInt(id));
  if (!patinete) throw new Error("Patinete não encontrado.");
  const eventos = [
    ...db.locacoes.filter(l => l.patineteId === patinete.id).map(l => ({
      tipo: "locação", data: l.dataInicio, fim: l.dataFim || null, titulo: l.cliente,
      detalhes: `${l.tempoMinutos} min · R$ ${Number(l.valorTotal || 0).toFixed(2)} · ${l.status}`
    })),
    ...db.manutencoes.filter(m => m.patineteId === patinete.id).map(m => ({
      tipo: "manutenção", data: m.data, fim: m.dataLiberacao || null, titulo: m.descricao,
      detalhes: `R$ ${Number(m.valor || 0).toFixed(2)} · ${m.status}`
    }))
  ].sort((a, b) => new Date(b.data) - new Date(a.data));
  return { patinete, eventos };
}

function iniciarLocacoes(patineteIds, cliente, telefone, tempo, valorBase, pagamento, usuarioOperador = "Operador") {
  const db = lerDB();
  const ids = [...new Set(patineteIds.map(Number))];
  if (!ids.length) throw new Error("Selecione pelo menos um patinete.");

  const patinetes = ids.map(id => db.patinetes.find(p => p.id === id));
  if (patinetes.some(p => !p)) throw new Error("Um dos patinetes selecionados não foi encontrado.");
  const indisponivel = patinetes.find(p => p.status !== "livre");
  if (indisponivel) throw new Error(`O patinete ${indisponivel.codigo} não está mais disponível.`);

  const agora = new Date().toISOString();
  const cadastroCliente = obterOuCriarCliente(db, cliente, telefone || "");
  let proximoId = db.locacoes.length ? Math.max(...db.locacoes.map(l => l.id)) + 1 : 1;
  const locacoes = patinetes.map(patinete => {
    patinete.status = "locado";
    patinete.cliente = cliente;
    patinete.telefone = telefone;
    patinete.pagamento = pagamento;
    patinete.tempo = parseInt(tempo);
    patinete.valorBase = parseFloat(valorBase);
    patinete.inicio = agora;

    return {
      id: proximoId++, patineteId: patinete.id, patineteCodigo: patinete.codigo,
      pontoId: patinete.pontoId || null, pontoNome: patinete.pontoNome || "Sem ponto",
      cliente: cliente.trim(), clienteId: cadastroCliente.id, telefone: telefone.trim(),
      tempoMinutos: parseInt(tempo), valorBase: parseFloat(valorBase), multa: 0,
      valorTotal: parseFloat(valorBase), pagamento, usuarioOperador, status: "ativa",
      dataInicio: agora, dataFim: null
    };
  });

  db.locacoes.push(...locacoes);
  salvarDB(db);
  return { patinetes, locacoes };
}

function finalizarLocacao(patineteId, multa = 0) {
  const db = lerDB();
  const pIndex = db.patinetes.findIndex(p => p.id === parseInt(patineteId));
  if (pIndex === -1) throw new Error("Patinete não encontrado");

  const patinete = db.patinetes[pIndex];
  const agora = new Date().toISOString();

  const locIndex = db.locacoes.findIndex(l => l.patineteId === patinete.id && l.status === "ativa");
  let locacao = null;

  if (locIndex !== -1) {
    locacao = db.locacoes[locIndex];
    locacao.multa = parseFloat(multa) || 0;
    locacao.valorTotal = locacao.valorBase + locacao.multa;
    locacao.dataFim = agora;
    locacao.status = "finalizada";
  }

  const novaBateria = Math.max(10, (patinete.bateria || 100) - Math.floor(Math.random() * 8 + 5));

  patinete.status = "livre";
  patinete.cliente = "";
  patinete.telefone = "";
  patinete.pagamento = "";
  patinete.tempo = 0;
  patinete.valorBase = 0;
  patinete.inicio = null;
  patinete.bateria = novaBateria;

  salvarDB(db);
  return { patinete, locacao };
}

// --- MANUTENÇÕES ---
function listarManutencoes() {
  const db = lerDB();
  return db.manutencoes;
}

function registrarManutencao(patineteId, descricao, valor, usuario = "Operador") {
  const db = lerDB();
  const pIndex = db.patinetes.findIndex(p => p.id === parseInt(patineteId));
  if (pIndex === -1) throw new Error("Patinete não encontrado");

  const patinete = db.patinetes[pIndex];
  patinete.status = "manutencao";

  const novaManutencao = {
    id: db.manutencoes.length ? Math.max(...db.manutencoes.map(m => m.id)) + 1 : 1,
    patineteId: patinete.id,
    patineteCodigo: patinete.codigo,
    pontoId: patinete.pontoId || 1,
    pontoNome: patinete.pontoNome || "Ponto Geral",
    descricao: descricao.trim(),
    prioridade: "media",
    diagnostico: "",
    responsavelServico: "",
    previsaoConclusao: null,
    valor: parseFloat(valor) || 0,
    usuario,
    status: "em_manutencao",
    data: new Date().toISOString()
  };

  db.manutencoes.push(novaManutencao);
  salvarDB(db);

  return { patinete, manutencao: novaManutencao };
}

function atualizarManutencao(id, dados = {}) {
  const db = lerDB();
  const manutencao = db.manutencoes.find(item => item.id === parseInt(id));
  if (!manutencao) throw new Error("Manutenção não encontrada.");
  const prioridades = ["baixa", "media", "urgente"];
  if (dados.prioridade !== undefined) {
    if (!prioridades.includes(dados.prioridade)) throw new Error("Prioridade inválida.");
    manutencao.prioridade = dados.prioridade;
  }
  if (dados.diagnostico !== undefined) manutencao.diagnostico = String(dados.diagnostico || "").trim().slice(0, 500);
  if (dados.responsavelServico !== undefined) manutencao.responsavelServico = String(dados.responsavelServico || "").trim().slice(0, 120);
  if (dados.previsaoConclusao !== undefined) manutencao.previsaoConclusao = dados.previsaoConclusao || null;
  if (dados.valor !== undefined) manutencao.valor = Math.max(0, parseFloat(dados.valor) || 0);

  if (dados.status === "concluida") {
    manutencao.status = "concluida";
    manutencao.dataLiberacao = new Date().toISOString();
    const patinete = db.patinetes.find(item => item.id === manutencao.patineteId);
    if (patinete) {
      patinete.status = "livre";
      patinete.bateria = 100;
    }
  }
  salvarDB(db);
  return manutencao;
}

function liberarManutencao(patineteId) {
  const db = lerDB();
  const pIndex = db.patinetes.findIndex(p => p.id === parseInt(patineteId));
  if (pIndex === -1) throw new Error("Patinete não encontrado");

  const patinete = db.patinetes[pIndex];
  patinete.status = "livre";
  patinete.bateria = 100;

  const manutencao = [...db.manutencoes]
    .reverse()
    .find(item => item.patineteId === patinete.id && !item.dataLiberacao);
  if (manutencao) {
    manutencao.status = "concluida";
    manutencao.dataLiberacao = new Date().toISOString();
  }

  salvarDB(db);
  return patinete;
}

// --- CONFIGURAÇÕES & ADMIN ---
function obterConfig() {
  const db = lerDB();
  return db.configuracoes;
}

function obterPainelOperacional() {
  const db = lerDB();
  const config = { ...CONFIG_PADRAO, ...(db.configuracoes || {}) };
  const agora = Date.now();
  const limiteManutencao = agora - Number(config.alertaManutencaoDias || 3) * 86400000;
  const manutencoesAbertas = db.manutencoes.filter(item => item.status === "em_manutencao");
  const locacoesAtrasadas = db.locacoes.filter(loc => loc.status === "ativa" && new Date(loc.dataInicio).getTime() + Number(loc.tempoMinutos || 0) * 60000 < agora);
  const operadores = db.usuarios.filter(user => (user.nivel || "operador") === "operador");
  const pendentes = db.usuarios.filter(user => (user.status || "aprovado") === "pendente");
  const patinetesSemPonto = db.patinetes.filter(pat => !pat.pontoId);

  const alertas = {
    manutencoesAntigas: manutencoesAbertas.filter(item => new Date(item.data).getTime() < limiteManutencao),
    locacoesAtrasadas,
    operadoresSemPonto: operadores.filter(user => !user.pontoId && !user.bloqueado),
    usuariosPendentes: pendentes,
    patinetesSemPonto
  };

  const dadosOperadores = operadores.map(user => {
    const nomes = new Set([user.usuario, user.nome].filter(Boolean).map(valor => String(valor).toLowerCase()));
    const locacoes = db.locacoes.filter(loc => nomes.has(String(loc.usuarioOperador || "").toLowerCase()));
    const manutencoes = manutencoesAbertas.filter(item => nomes.has(String(item.usuario || "").toLowerCase()));
    const ultimaAtividade = user.ultimaAtividade || user.ultimoLogin || null;
    return {
      id: user.id, nome: user.nome, usuario: user.usuario, status: user.status,
      bloqueado: Boolean(user.bloqueado), pontoId: user.pontoId || null,
      pontoNome: db.pontos.find(ponto => ponto.id === user.pontoId)?.nome || "Sem ponto",
      ultimoLogin: user.ultimoLogin || null, ultimaAtividade,
      online: Boolean(ultimaAtividade && agora - new Date(ultimaAtividade).getTime() <= 15 * 60000),
      totalLocacoes: locacoes.length, manutencoesAbertas: manutencoes.length
    };
  });

  const agrupar = (lista, chave, valor = () => 1) => Object.values(lista.reduce((acc, item) => {
    const nome = chave(item) || "Não informado";
    if (!acc[nome]) acc[nome] = { nome, total: 0 };
    acc[nome].total += Number(valor(item) || 0);
    return acc;
  }, {})).sort((a, b) => b.total - a.total);

  return {
    alertas,
    operadores: dadosOperadores,
    desempenho: {
      operadoresPorLocacoes: [...dadosOperadores].sort((a, b) => b.totalLocacoes - a.totalLocacoes),
      faturamentoPorPonto: agrupar(db.locacoes, loc => loc.pontoNome || "Sem ponto", loc => loc.valorTotal),
      patinetesMaisUtilizados: agrupar(db.locacoes, loc => loc.patineteCodigo || `PAT${loc.patineteId}`),
      manutencoesPorPonto: agrupar(db.manutencoes, item => item.pontoNome || "Sem ponto"),
      horariosMaiorMovimento: agrupar(db.locacoes, loc => `${String(new Date(loc.dataInicio).getHours()).padStart(2, "0")}:00`).slice(0, 8)
    }
  };
}

function salvarConfig(config) {
  const db = lerDB();
  db.configuracoes = { ...db.configuracoes, ...config };
  salvarDB(db);
  return db.configuracoes;
}

// --- CONSOLIDADOR DE RELATÓRIOS ---
function obterResumoGeral(mesFiltro = null) {
  const db = lerDB();
  const agora = new Date();

  const mesAtualStr = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
  const mesAlvo = mesFiltro === "todos"
    ? null
    : (!mesFiltro || mesFiltro === "atual" ? mesAtualStr : mesFiltro);

  const mesAnteriorData = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const mesAnteriorStr = `${mesAnteriorData.getFullYear()}-${String(mesAnteriorData.getMonth() + 1).padStart(2, "0")}`;
  const somar = (lista, campo) => lista.reduce((total, item) => total + (parseFloat(item[campo]) || 0), 0);
  const calcularVariacao = (atual, anterior) => {
    if (!anterior) return atual ? null : 0;
    return ((atual - anterior) / Math.abs(anterior)) * 100;
  };
  const consolidarMes = mes => {
    const locacoes = db.locacoes.filter(l => (l.dataInicio || "").slice(0, 7) === mes);
    const manutencoes = db.manutencoes.filter(m => (m.data || "").slice(0, 7) === mes);
    const faturamento = somar(locacoes, "valorTotal");
    const manutencao = somar(manutencoes, "valor");
    return { locacoes: locacoes.length, faturamento, manutencao, lucro: faturamento - manutencao };
  };

  const totalPatinetes = db.patinetes.length;
  const patinetesLivres = db.patinetes.filter(p => p.status === "livre").length;
  const patinetesLocados = db.patinetes.filter(p => p.status === "locado" || p.status === "atrasado").length;
  const patinetesManutencao = db.patinetes.filter(p => p.status === "manutencao").length;

  const locacoesFiltradas = db.locacoes.filter(loc => {
    if (!mesAlvo) return true;
    const mesLoc = (loc.dataInicio || "").slice(0, 7);
    return mesLoc === mesAlvo;
  });

  const manutencoesFiltradas = db.manutencoes.filter(m => {
    if (!mesAlvo) return true;
    const mesMan = (m.data || "").slice(0, 7);
    return mesMan === mesAlvo;
  });

  const totalLocacoes = locacoesFiltradas.length;
  const faturamentoTotal = locacoesFiltradas.reduce((acc, l) => acc + (parseFloat(l.valorTotal) || 0), 0);
  const gastoManutencaoTotal = manutencoesFiltradas.reduce((acc, m) => acc + (parseFloat(m.valor) || 0), 0);
  const lucroTotal = faturamentoTotal - gastoManutencaoTotal;

  const locacoesRecebidas = locacoesFiltradas.filter(l => l.status === "finalizada");
  const locacoesCanceladas = locacoesFiltradas.filter(l => l.status === "cancelada");
  const locacoesPendentes = locacoesFiltradas.filter(l => !["finalizada", "cancelada"].includes(l.status));
  const financeiroPagamento = {
    recebido: somar(locacoesRecebidas, "valorTotal"),
    pendente: somar(locacoesPendentes, "valorTotal"),
    multas: somar(locacoesFiltradas, "multa"),
    cancelado: somar(locacoesCanceladas, "valorTotal"),
    quantidadePendentes: locacoesPendentes.length,
    quantidadeCanceladas: locacoesCanceladas.length
  };

  const atualComparacao = consolidarMes(mesAtualStr);
  const anteriorComparacao = consolidarMes(mesAnteriorStr);
  const comparacao = {
    mesAtual: mesAtualStr,
    mesAnterior: mesAnteriorStr,
    atual: atualComparacao,
    anterior: anteriorComparacao,
    variacoes: {
      locacoes: calcularVariacao(atualComparacao.locacoes, anteriorComparacao.locacoes),
      faturamento: calcularVariacao(atualComparacao.faturamento, anteriorComparacao.faturamento),
      manutencao: calcularVariacao(atualComparacao.manutencao, anteriorComparacao.manutencao),
      lucro: calcularVariacao(atualComparacao.lucro, anteriorComparacao.lucro)
    }
  };

  const faturamentoHistorico = db.locacoes.reduce((acc, l) => acc + (parseFloat(l.valorTotal) || 0), 0);
  const locacoesHistorico = db.locacoes.length;

  const porDia = {};
  locacoesFiltradas.forEach(loc => {
    const dataStr = (loc.dataInicio || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (!porDia[dataStr]) porDia[dataStr] = { faturamento: 0, manutencao: 0, locacoes: 0 };
    porDia[dataStr].faturamento += parseFloat(loc.valorTotal) || 0;
    porDia[dataStr].locacoes += 1;
  });

  manutencoesFiltradas.forEach(m => {
    const dataStr = (m.data || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (!porDia[dataStr]) porDia[dataStr] = { faturamento: 0, manutencao: 0, locacoes: 0 };
    porDia[dataStr].manutencao += parseFloat(m.valor) || 0;
  });

  const porPagamento = {};
  locacoesFiltradas.forEach(loc => {
    const forma = loc.pagamento || "Outro";
    porPagamento[forma] = (porPagamento[forma] || 0) + (parseFloat(loc.valorTotal) || 0);
  });

  const usoPorPatinete = db.patinetes.map(pat => {
    const locs = locacoesFiltradas.filter(l => l.patineteId === pat.id);
    const mans = manutencoesFiltradas.filter(m => m.patineteId === pat.id);
    const fat = locs.reduce((acc, l) => acc + (parseFloat(l.valorTotal) || 0), 0);
    const manGasto = mans.reduce((acc, m) => acc + (parseFloat(m.valor) || 0), 0);

    return {
      id: pat.id,
      codigo: pat.codigo,
      modelo: pat.modelo,
      bateria: pat.bateria,
      status: pat.status,
      pontoNome: pat.pontoNome || "Sem ponto",
      totalLocacoes: locs.length,
      faturamentoGerado: fat,
      gastoManutencao: manGasto,
      lucroLiquido: fat - manGasto
    };
  });

  const faturamentoPorPonto = [];
  const nomesPontos = new Set([
    ...locacoesFiltradas.map(l => l.pontoNome || "Sem ponto"),
    ...manutencoesFiltradas.map(m => m.pontoNome || "Sem ponto")
  ]);
  nomesPontos.forEach(nome => {
    const locs = locacoesFiltradas.filter(l => (l.pontoNome || "Sem ponto") === nome);
    const mans = manutencoesFiltradas.filter(m => (m.pontoNome || "Sem ponto") === nome);
    const faturamento = somar(locs, "valorTotal");
    const despesas = somar(mans, "valor");
    faturamentoPorPonto.push({ pontoNome: nome, locacoes: locs.length, faturamento, despesas, lucro: faturamento - despesas });
  });
  faturamentoPorPonto.sort((a, b) => b.faturamento - a.faturamento);

  const desempenhoPorOperador = [];
  const operadores = new Set([
    ...locacoesFiltradas.map(l => l.usuarioOperador || "Não informado"),
    ...manutencoesFiltradas.map(m => m.usuario || "Não informado")
  ]);
  operadores.forEach(nome => {
    const locs = locacoesFiltradas.filter(l => (l.usuarioOperador || "Não informado") === nome);
    const mansAbertas = manutencoesFiltradas.filter(m => (m.usuario || "Não informado") === nome && m.status !== "concluida");
    desempenhoPorOperador.push({
      operador: nome,
      iniciadas: locs.length,
      finalizadas: locs.filter(l => l.status === "finalizada").length,
      manutencoesAbertas: mansAbertas.length,
      faturamento: somar(locs, "valorTotal")
    });
  });
  desempenhoPorOperador.sort((a, b) => b.faturamento - a.faturamento);

  return {
    periodo: mesAlvo || "Historico Completo",
    mesAtual: mesAtualStr,
    frota: {
      total: totalPatinetes,
      livres: patinetesLivres,
      locados: patinetesLocados,
      manutencao: patinetesManutencao
    },
    financeiro: {
      totalLocacoes,
      faturamentoTotal,
      gastoManutencaoTotal,
      lucroTotal,
      faturamentoHistorico,
      locacoesHistorico,
      pagamentos: financeiroPagamento
    },
    comparacao,
    porDia,
    porPagamento,
    faturamentoPorPonto,
    desempenhoPorOperador,
    usoPorPatinete
  };
}

module.exports = {
  hashSenha,
  verificarSenha,
  listarUsuarios,
  cadastrarUsuario,
  autenticarUsuario,
  obterUsuarioSessao,
  registrarAtividadeUsuario,
  alterarStatusUsuario,
  alterarBloqueioUsuario,
  alterarNivelUsuario,
  alterarPontoUsuario,
  excluirUsuarioRecusado,
  listarHistoricoUsuarios,
  listarPontos,
  adicionarPonto,
  removerPonto,
  listarPatinetes,
  buscarPatinetePorId,
  adicionarPatinetes,
  removerPatinete,
  atualizarPatinete,
  listarLocacoes,
  listarClientes,
  obterHistoricoCliente,
  obterHistoricoPatinete,
  iniciarLocacoes,
  finalizarLocacao,
  listarManutencoes,
  registrarManutencao,
  atualizarManutencao,
  liberarManutencao,
  obterConfig,
  salvarConfig,
  obterPainelOperacional,
  obterResumoGeral
};
