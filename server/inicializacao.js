// Inicialização do banco: aplica o esquema (database.sql) e, se o banco ainda
// não tiver dados, migra o formato antigo (tabela "sistema" com um JSON único)
// ou cria os dados iniciais. Roda uma vez por processo, dentro de uma
// transação com lock, então várias instâncias não executam ao mesmo tempo.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");

const pbkdf2 = promisify(crypto.pbkdf2);
const ITERACOES_SENHA = 120000;
const ITERACOES_LEGADAS = 1000; // senhas antigas sem "iteracoesSenha"
const FORMAS_PAGAMENTO = ["Pix", "Cartão de Crédito", "Cartão de Débito", "Dinheiro"];
const CHAVE_LOCK = 734201; // pg_advisory_xact_lock: identificador arbitrário do E-Scooter GO

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

async function hashSenha(senha, salt, iteracoes = ITERACOES_SENHA) {
  return (await pbkdf2(senha, salt, iteracoes, 64, "sha512")).toString("hex");
}

const somenteDigitos = valor => String(valor || "").replace(/\D/g, "");
const texto = (valor, maximo, padrao = "") => {
  const limpo = String(valor ?? "").trim();
  return (limpo || padrao).slice(0, maximo);
};
const numero = (valor, minimo, maximo, padrao) => {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.min(maximo, Math.max(minimo, n)) : padrao;
};
const dataOuAgora = valor => {
  const d = new Date(valor);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
};
const dataOuNulo = valor => {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

async function inicializarBanco(conexao) {
  const esquema = fs.readFileSync(path.join(__dirname, "database.sql"), "utf8");
  await conexao.query("BEGIN");
  try {
    await conexao.query("SELECT pg_advisory_xact_lock($1)", [CHAVE_LOCK]);
    await conexao.query(esquema);

    const { rows: [{ existe }] } = await conexao.query("SELECT EXISTS (SELECT 1 FROM configuracoes) AS existe");
    if (!existe) {
      const legado = await lerSistemaLegado(conexao);
      if (legado) {
        await migrarDadosLegados(conexao, legado);
      } else {
        await criarDadosIniciais(conexao);
      }
    }
    await conexao.query("COMMIT");
  } catch (error) {
    await conexao.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function lerSistemaLegado(conexao) {
  const { rows: [tabela] } = await conexao.query("SELECT to_regclass('public.sistema') AS nome");
  if (!tabela.nome) return null;
  const { rows } = await conexao.query("SELECT dados FROM sistema WHERE id = 1");
  return rows.length ? rows[0].dados : null;
}

async function salvarConfiguracoes(conexao, config) {
  await conexao.query(
    `INSERT INTO configuracoes (id, nome_admin, cargo_admin, nome_empresa, multa_por_minuto, limite_patinetes_locacao, alerta_manutencao_dias)
     VALUES (1, $1, $2, $3, $4, $5, $6)`,
    [
      texto(config.nomeAdmin, 100, CONFIG_PADRAO.nomeAdmin),
      texto(config.cargoAdmin, 100, CONFIG_PADRAO.cargoAdmin),
      texto(config.nomeEmpresa, 100, CONFIG_PADRAO.nomeEmpresa),
      numero(config.multaPorMinuto, 0, 99999999, CONFIG_PADRAO.multaPorMinuto),
      Math.round(numero(config.limitePatinetesLocacao, 1, 20, CONFIG_PADRAO.limitePatinetesLocacao)),
      Math.round(numero(config.alertaManutencaoDias, 1, 365, CONFIG_PADRAO.alertaManutencaoDias))
    ]
  );
  const tempos = [...new Set((config.temposDisponiveis || CONFIG_PADRAO.temposDisponiveis).map(Number))]
    .filter(t => Number.isInteger(t) && t >= 1 && t <= 1440);
  for (const tempo of tempos.length ? tempos : CONFIG_PADRAO.temposDisponiveis) {
    const valor = Number(config.precos?.[tempo] ?? CONFIG_PADRAO.precos[tempo]);
    if (Number.isFinite(valor) && valor > 0) {
      await conexao.query("INSERT INTO precos (tempo_minutos, valor) VALUES ($1, $2)", [tempo, valor]);
    }
  }
}

async function ajustarSequencias(conexao) {
  for (const tabela of ["pontos", "usuarios", "patinetes", "clientes", "locacoes", "manutencoes", "historico_usuarios"]) {
    await conexao.query(
      `SELECT setval(pg_get_serial_sequence('${tabela}', 'id'), COALESCE((SELECT MAX(id) FROM ${tabela}), 0) + 1, false)`
    );
  }
}

// --- Banco novo: dados iniciais ---------------------------------------------
async function criarDadosIniciais(conexao) {
  const senhaInicial = process.env.ADMIN_SENHA_INICIAL || "admin123";
  if (!process.env.ADMIN_SENHA_INICIAL) {
    console.warn("[AVISO] Criando usuário 'admin' com a senha padrão 'admin123'. Defina ADMIN_SENHA_INICIAL para usar outra senha.");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  await conexao.query(
    `INSERT INTO usuarios (nome, usuario, senha_hash, salt, iteracoes_senha, cargo, nivel, status)
     VALUES ('Administrador Geral', 'admin', $1, $2, $3, 'Gestor do Sistema', 'administrador', 'aprovado')`,
    [await hashSenha(senhaInicial, salt), salt, ITERACOES_SENHA]
  );

  await conexao.query(`
    INSERT INTO pontos (id, nome, localizacao) VALUES
      (1, 'Uni goias', '-16.691576, -49.310984'),
      (2, 'Hidrolandia', 'Praça lago'),
      (3, 'Teste', 'Sem localização')`);
  await conexao.query(`
    INSERT INTO patinetes (id, codigo, modelo, bateria, ponto_id) VALUES
      (1, 'PAT001', 'E-Scooter Pro Max', 100, 2), (2, 'PAT002', 'E-Scooter Pro Max', 85, 2),
      (3, 'PAT003', 'E-Scooter Urban', 90, 2),    (4, 'PAT004', 'E-Scooter Urban', 70, 2),
      (5, 'PAT005', 'E-Scooter Lite', 95, NULL),  (6, 'PAT006', 'E-Scooter Lite', 100, NULL),
      (7, 'PAT007', 'E-Scooter Lite', 100, 3),    (8, 'PAT008', 'E-Scooter Urban', 95, 3),
      (9, 'PAT009', 'E-Scooter Pro Max', 100, 3), (10, 'PAT010', 'E-Scooter Pro Max', 100, 1)`);
  await salvarConfiguracoes(conexao, CONFIG_PADRAO);
  await ajustarSequencias(conexao);
  console.log("[banco] Banco criado com os dados iniciais.");
}

// --- Migração do formato antigo (JSON único na tabela "sistema") -------------
async function migrarDadosLegados(conexao, dados) {
  const avisos = [];
  const lista = chave => (Array.isArray(dados[chave]) ? dados[chave] : []);

  // Pontos
  const pontos = new Map();
  for (const p of lista("pontos")) {
    const id = parseInt(p.id);
    if (!Number.isInteger(id) || pontos.has(id)) continue;
    await conexao.query("INSERT INTO pontos (id, nome, localizacao, criado_em) VALUES ($1, $2, $3, $4)",
      [id, texto(p.nome, 100, `Ponto ${id}`), texto(p.localizacao, 180, "Sem localização"), dataOuAgora(p.criadoEm)]);
    pontos.set(id, texto(p.nome, 100, `Ponto ${id}`));
  }
  const pontoValido = id => (pontos.has(parseInt(id)) ? parseInt(id) : null);

  // Usuários
  const usuarios = new Map(); // login em minúsculas -> id
  for (const u of lista("usuarios")) {
    const id = parseInt(u.id);
    const login = texto(u.usuario, 40);
    if (!Number.isInteger(id) || !login || !u.senhaHash || !u.salt || usuarios.has(login.toLowerCase())) {
      avisos.push(`usuário ignorado (id=${u.id}, usuario=${u.usuario}): dados incompletos ou login duplicado`);
      continue;
    }
    const nivel = login === "admin" || u.nivel === "administrador" ? "administrador" : "operador";
    const status = ["pendente", "aprovado", "recusado"].includes(u.status) ? u.status : "aprovado";
    await conexao.query(
      `INSERT INTO usuarios (id, nome, usuario, senha_hash, salt, iteracoes_senha, cargo, nivel, status, bloqueado,
                             ponto_id, ultimo_login, ultima_atividade, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, texto(u.nome, 100, login), login, u.senhaHash, u.salt, parseInt(u.iteracoesSenha) || ITERACOES_LEGADAS,
       texto(u.cargo, 60, nivel === "administrador" ? "Administrador" : "Operador"), nivel, status, Boolean(u.bloqueado),
       pontoValido(u.pontoId), dataOuNulo(u.ultimoLogin), dataOuNulo(u.ultimaAtividade || u.ultimoLogin), dataOuAgora(u.criadoEm)]);
    usuarios.set(login.toLowerCase(), id);
  }
  const idUsuario = login => usuarios.get(String(login || "").toLowerCase()) || null;

  // Patinetes
  const patinetes = new Map(); // id -> codigo
  for (const p of lista("patinetes")) {
    const id = parseInt(p.id);
    if (!Number.isInteger(id) || patinetes.has(id)) continue;
    const codigo = texto(p.codigo, 20, `PAT${String(id).padStart(3, "0")}`);
    const status = p.status === "manutencao" ? "manutencao" : (["locado", "atrasado"].includes(p.status) ? "locado" : "livre");
    await conexao.query(
      "INSERT INTO patinetes (id, codigo, modelo, bateria, status, ponto_id, criado_em) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, codigo, texto(p.modelo, 60, "E-Scooter Pro Max"), Math.round(numero(p.bateria, 0, 100, 100)), status,
       pontoValido(p.pontoId), dataOuAgora(p.criadoEm)]);
    patinetes.set(id, codigo);
  }

  // Clientes (identificados pelos dígitos do telefone)
  const clientePorIdLegado = new Map();
  const clientePorDigitos = new Map();
  const clientePorNome = new Map();
  let proximoCliente = 1;
  async function obterCliente(nome, telefone, criadoEm, idLegado) {
    if (idLegado !== undefined && clientePorIdLegado.has(idLegado)) return clientePorIdLegado.get(idLegado);
    const digitos = somenteDigitos(telefone);
    const chaveNome = String(nome || "").trim().toLowerCase();
    let id = digitos ? clientePorDigitos.get(digitos) : clientePorNome.get(chaveNome);
    if (!id) {
      id = proximoCliente++;
      await conexao.query("INSERT INTO clientes (id, nome, telefone, telefone_digitos, criado_em) VALUES ($1, $2, $3, $4, $5)",
        [id, texto(nome, 100, "Cliente"), texto(telefone, 20), digitos ? digitos.slice(0, 20) : null, dataOuAgora(criadoEm)]);
      if (digitos) clientePorDigitos.set(digitos, id);
      else clientePorNome.set(chaveNome, id);
    }
    if (idLegado !== undefined) clientePorIdLegado.set(idLegado, id);
    return id;
  }
  for (const c of lista("clientes")) await obterCliente(c.nome, c.telefone, c.criadoEm, parseInt(c.id));

  // Locações (em ordem cronológica; só a mais recente "ativa" de cada patinete continua ativa)
  const locacoes = [...lista("locacoes")].sort((a, b) => new Date(a.dataInicio) - new Date(b.dataInicio));
  const ultimaAtivaPorPatinete = new Map();
  locacoes.forEach(l => { if (l.status === "ativa") ultimaAtivaPorPatinete.set(parseInt(l.patineteId), l); });
  const idsLocacao = new Set();
  for (const l of locacoes) {
    let id = parseInt(l.id);
    if (!Number.isInteger(id) || idsLocacao.has(id)) id = null; // o banco gera um novo
    const patineteId = patinetes.has(parseInt(l.patineteId)) ? parseInt(l.patineteId) : null;
    const clienteId = Number.isInteger(parseInt(l.clienteId)) && clientePorIdLegado.has(parseInt(l.clienteId))
      ? clientePorIdLegado.get(parseInt(l.clienteId))
      : await obterCliente(l.cliente, l.telefone, l.dataInicio);
    let status = ["ativa", "finalizada", "cancelada"].includes(l.status) ? l.status : "finalizada";
    if (status === "ativa" && (ultimaAtivaPorPatinete.get(parseInt(l.patineteId)) !== l || !patineteId)) {
      status = "finalizada";
      avisos.push(`locação ${l.id}: marcada como finalizada (havia outra locação ativa para o mesmo patinete)`);
    }
    let pagamento = l.pagamento;
    if (!FORMAS_PAGAMENTO.includes(pagamento)) {
      avisos.push(`locação ${l.id}: forma de pagamento "${pagamento}" desconhecida, gravada como "Dinheiro"`);
      pagamento = "Dinheiro";
    }
    const dataInicio = dataOuAgora(l.dataInicio);
    let dataFim = status === "ativa" ? null : dataOuNulo(l.dataFim);
    if (dataFim && dataFim < dataInicio) dataFim = dataInicio;
    const valores = [patineteId, texto(l.patineteCodigo, 20, patinetes.get(patineteId) || `PAT${l.patineteId}`), clienteId,
      pontoValido(l.pontoId), texto(l.pontoNome, 100, "Sem ponto"), idUsuario(l.usuarioOperador),
      texto(l.usuarioOperador, 40, "desconhecido"), Math.round(numero(l.tempoMinutos, 1, 1440, 1)),
      numero(l.valorBase, 0, 99999999, 0), numero(l.multa, 0, 99999999, 0), pagamento, status, dataInicio, dataFim];
    const { rows: [inserida] } = id
      ? await conexao.query(
        `INSERT INTO locacoes (id, patinete_id, patinete_codigo, cliente_id, ponto_id, ponto_nome, operador_id, operador_usuario,
                               tempo_minutos, valor_base, multa, pagamento, status, data_inicio, data_fim)
         VALUES ($15, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`, [...valores, id])
      : await conexao.query(
        `INSERT INTO locacoes (patinete_id, patinete_codigo, cliente_id, ponto_id, ponto_nome, operador_id, operador_usuario,
                               tempo_minutos, valor_base, multa, pagamento, status, data_inicio, data_fim)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`, valores);
    idsLocacao.add(inserida.id);
  }

  // Manutenções (id repetido ou inválido: o banco gera um novo)
  const idsManutencao = new Set();
  for (const m of lista("manutencoes")) {
    let id = parseInt(m.id);
    if (!Number.isInteger(id) || idsManutencao.has(id)) id = null;
    else idsManutencao.add(id);
    const patineteId = patinetes.has(parseInt(m.patineteId)) ? parseInt(m.patineteId) : null;
    const status = m.status === "concluida" || m.dataLiberacao ? "concluida" : "em_manutencao";
    await conexao.query(
      `INSERT INTO manutencoes (id, patinete_id, patinete_codigo, ponto_id, ponto_nome, usuario_id, usuario_login, descricao,
                                prioridade, diagnostico, responsavel_servico, previsao_conclusao, valor, status, data, data_liberacao)
       VALUES (COALESCE($1, nextval(pg_get_serial_sequence('manutencoes', 'id'))), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [id, patineteId, texto(m.patineteCodigo, 20, patinetes.get(patineteId) || `PAT${m.patineteId}`),
       pontoValido(m.pontoId), texto(m.pontoNome, 100, "Sem ponto"), idUsuario(m.usuario), texto(m.usuario, 40, "desconhecido"),
       texto(m.descricao, 300, "Não informado"), ["baixa", "media", "urgente"].includes(m.prioridade) ? m.prioridade : "media",
       texto(m.diagnostico, 500), texto(m.responsavelServico, 120), dataOuNulo(m.previsaoConclusao),
       numero(m.valor, 0, 100000, 0), status, dataOuAgora(m.data), status === "concluida" ? dataOuNulo(m.dataLiberacao) || dataOuAgora(m.data) : null]);
  }

  // Histórico de usuários (ids antigos eram Date.now(); o banco gera novos em ordem cronológica)
  const historico = [...lista("historicoUsuarios")].sort((a, b) => new Date(a.data) - new Date(b.data));
  for (const h of historico) {
    const usuarioId = Number.isInteger(parseInt(h.usuarioId)) && [...usuarios.values()].includes(parseInt(h.usuarioId)) ? parseInt(h.usuarioId) : null;
    await conexao.query(
      "INSERT INTO historico_usuarios (acao, usuario_id, usuario_nome, responsavel, detalhes, data) VALUES ($1, $2, $3, $4, $5, $6)",
      [texto(h.acao, 40, "ação"), usuarioId, texto(h.usuarioNome, 100, "Usuário"), texto(h.responsavel, 40, "sistema"),
       String(h.detalhes || ""), dataOuAgora(h.data)]);
  }

  await salvarConfiguracoes(conexao, { ...CONFIG_PADRAO, ...(dados.configuracoes || {}) });
  await ajustarSequencias(conexao);

  // Status do patinete coerente com as locações/manutenções migradas
  await conexao.query(`
    UPDATE patinetes p SET status = 'livre'
     WHERE p.status = 'locado' AND NOT EXISTS (SELECT 1 FROM locacoes l WHERE l.patinete_id = p.id AND l.status = 'ativa')`);
  await conexao.query(`
    UPDATE patinetes p SET status = 'locado'
     WHERE p.status <> 'locado' AND EXISTS (SELECT 1 FROM locacoes l WHERE l.patinete_id = p.id AND l.status = 'ativa')`);

  // A tabela antiga é mantida como backup (renomeada), nunca apagada.
  const { rows: [{ nome }] } = await conexao.query(
    "SELECT CASE WHEN to_regclass('public.sistema_legado') IS NULL THEN 'sistema_legado' ELSE 'sistema_legado_' || to_char(now(), 'YYYYMMDDHH24MISS') END AS nome");
  await conexao.query(`ALTER TABLE sistema RENAME TO ${nome}`);

  const { rows: [contagem] } = await conexao.query(`
    SELECT (SELECT COUNT(*) FROM usuarios) AS usuarios, (SELECT COUNT(*) FROM pontos) AS pontos,
           (SELECT COUNT(*) FROM patinetes) AS patinetes, (SELECT COUNT(*) FROM clientes) AS clientes,
           (SELECT COUNT(*) FROM locacoes) AS locacoes, (SELECT COUNT(*) FROM manutencoes) AS manutencoes,
           (SELECT COUNT(*) FROM historico_usuarios) AS historico`);
  console.log(`[banco] Dados migrados do formato antigo: ${JSON.stringify(contagem)}. Backup mantido na tabela "${nome}".`);
  avisos.forEach(aviso => console.warn(`[banco] migração: ${aviso}`));
}

module.exports = { inicializarBanco, hashSenha, ITERACOES_SENHA, CONFIG_PADRAO, FORMAS_PAGAMENTO };
