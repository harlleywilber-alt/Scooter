// E-Scooter GO - Regras de negócio e consultas SQL
// Operações que dependem do estado atual rodam em transação com SELECT ... FOR UPDATE
const crypto = require("crypto");
const { consultar, transacao, definirInicializador, erroDeValidacao, BancoIndisponivelError } = require("./conexao");
const { inicializarBanco, hashSenha, ITERACOES_SENHA } = require("./inicializacao");

definirInicializador(inicializarBanco);

// ==========================================
// UTILITÁRIOS
// ==========================================
async function gerarSalt() {
  return crypto.randomBytes(16).toString("hex");
}

async function verificarSenha(senhaDigitada, hashArmazenado, salt, iteracoes = ITERACOES_SENHA) {
  const hashTeste = await hashSenha(senhaDigitada, salt, iteracoes);
  return hashTeste.length === hashArmazenado.length && crypto.timingSafeEqual(Buffer.from(hashTeste), Buffer.from(hashArmazenado));
}

// ID inválido vira null (nunca encontra registro)
function idOuNulo(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}

const falha = mensagem => erroDeValidacao(mensagem);

// Dia e mês no fuso da operação (as datas ficam em UTC no banco)
const FUSO_HORARIO = process.env.APP_TZ || "America/Sao_Paulo";
const formatadorDia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_HORARIO, year: "numeric", month: "2-digit", day: "2-digit" });
function diaLocal(data) {
  const d = data instanceof Date ? data : new Date(data);
  return data && Number.isFinite(d.getTime()) ? formatadorDia.format(d) : "";
}
function mesLocal(data) {
  return diaLocal(data).slice(0, 7);
}
function mesAnteriorDe(mes) {
  const [ano, m] = mes.split("-").map(Number);
  return m === 1 ? `${ano - 1}-12` : `${ano}-${String(m - 1).padStart(2, "0")}`;
}

// Multa = minutos completos de atraso x multa por minuto
function calcularMulta(locacao, multaPorMinuto, agoraMs = Date.now()) {
  const inicioMs = new Date(locacao.dataInicio).getTime();
  if (!Number.isFinite(inicioMs)) return 0;
  const fimPrevistoMs = inicioMs + Number(locacao.tempoMinutos || 0) * 60000;
  const atrasoMin = Math.floor(Math.max(0, agoraMs - fimPrevistoMs) / 60000);
  return Math.round(atrasoMin * Math.max(0, Number(multaPorMinuto) || 0) * 100) / 100;
}

// ==========================================
// CONSULTAS REUTILIZADAS
// ==========================================
const SELECT_PATINETE = `
  SELECT p.id, p.codigo, p.modelo, p.bateria, p.status,
         p.ponto_id AS "pontoId", COALESCE(pt.nome, 'Sem ponto') AS "pontoNome",
         COALESCE(c.nome, '') AS cliente, COALESCE(c.telefone, '') AS telefone,
         COALESCE(l.pagamento, '') AS pagamento, COALESCE(l.tempo_minutos, 0) AS tempo,
         COALESCE(l.valor_base, 0) AS "valorBase", l.data_inicio AS inicio, p.criado_em AS "criadoEm"
    FROM patinetes p
    LEFT JOIN pontos pt ON pt.id = p.ponto_id
    LEFT JOIN locacoes l ON l.patinete_id = p.id AND l.status = 'ativa'
    LEFT JOIN clientes c ON c.id = l.cliente_id`;

const SELECT_LOCACAO = `
  SELECT l.id, l.patinete_id AS "patineteId", l.patinete_codigo AS "patineteCodigo",
         l.ponto_id AS "pontoId", l.ponto_nome AS "pontoNome",
         c.nome AS cliente, l.cliente_id AS "clienteId", c.telefone,
         l.tempo_minutos AS "tempoMinutos", l.valor_base AS "valorBase", l.multa, l.valor_total AS "valorTotal",
         l.pagamento, l.operador_usuario AS "usuarioOperador", l.status,
         l.data_inicio AS "dataInicio", l.data_fim AS "dataFim"
    FROM locacoes l
    JOIN clientes c ON c.id = l.cliente_id`;

const SELECT_MANUTENCAO = `
  SELECT m.id, m.patinete_id AS "patineteId", m.patinete_codigo AS "patineteCodigo",
         m.ponto_id AS "pontoId", m.ponto_nome AS "pontoNome", m.descricao, m.prioridade, m.diagnostico,
         m.responsavel_servico AS "responsavelServico", m.previsao_conclusao AS "previsaoConclusao",
         m.valor, m.usuario_login AS usuario, m.status, m.data, m.data_liberacao AS "dataLiberacao"
    FROM manutencoes m`;

const COLUNAS_USUARIO = `
  id, nome, usuario, cargo, nivel, status, criado_em AS "criadoEm",
  ultimo_login AS "ultimoLogin", COALESCE(ultima_atividade, ultimo_login) AS "ultimaAtividade",
  bloqueado, ponto_id AS "pontoId"`;

async function buscarPatinetes(executor, ids) {
  const { rows } = await executor.query(`${SELECT_PATINETE} WHERE p.id = ANY($1::int[]) ORDER BY p.id`, [ids]);
  return rows;
}

async function travarUsuario(cliente, id) {
  const { rows: [user] } = await cliente.query(
    `SELECT id, nome, usuario, nivel, status, ponto_id AS "pontoId", bloqueado FROM usuarios WHERE id = $1 FOR UPDATE`,
    [idOuNulo(id)]);
  if (!user) throw falha("Usuário não encontrado.");
  return user;
}

async function registrarHistorico(cliente, acao, user, responsavel = "admin", detalhes = "") {
  await cliente.query(
    "INSERT INTO historico_usuarios (acao, usuario_id, usuario_nome, responsavel, detalhes) VALUES ($1, $2, $3, $4, $5)",
    [acao, user.id, user.nome, String(responsavel || "sistema").slice(0, 40), detalhes]);
}

// ==========================================
// USUÁRIOS
// ==========================================
async function listarUsuarios() {
  const { rows } = await consultar(`SELECT ${COLUNAS_USUARIO} FROM usuarios ORDER BY id`);
  return rows;
}

async function buscarUsuarioPorLogin(usuario) {
  const { rows: [user] } = await consultar(`SELECT ${COLUNAS_USUARIO} FROM usuarios WHERE usuario = $1`, [String(usuario || "")]);
  return user;
}

async function obterUsuarioSessao(id) {
  const { rows: [user] } = await consultar(
    `SELECT id, nome, usuario, nivel, status, bloqueado, ponto_id AS "pontoId" FROM usuarios WHERE id = $1`, [idOuNulo(id)]);
  return user || null;
}

async function cadastrarUsuario(nome, usuario, senha) {
  const salt = await gerarSalt();
  const senhaHash = await hashSenha(senha, salt);
  const { rows: [novo] } = await consultar(
    `INSERT INTO usuarios (nome, usuario, senha_hash, salt, iteracoes_senha, cargo, nivel, status)
     VALUES ($1, $2, $3, $4, $5, 'Operador', 'operador', 'pendente')
     RETURNING id, nome, usuario, cargo, status`,
    [nome.trim(), usuario.trim(), senhaHash, salt, ITERACOES_SENHA]);
  return novo;
}

async function autenticarUsuario(usuario, senha) {
  const { rows: [user] } = await consultar(
    `SELECT id, nome, usuario, cargo, nivel, status, bloqueado, ponto_id AS "pontoId",
            senha_hash AS "senhaHash", salt, iteracoes_senha AS "iteracoesSenha"
       FROM usuarios WHERE usuario = $1`, [String(usuario)]); // diferencia maiúsculas e minúsculas
  if (!user) return { erro: "Usuário ou senha inválidos." };

  const senhaValida = await verificarSenha(senha, user.senhaHash, user.salt, user.iteracoesSenha);
  if (!senhaValida) return { erro: "Usuário ou senha inválidos." };

  // Atualiza senhas antigas para o número atual de iterações
  if (user.iteracoesSenha < ITERACOES_SENHA) {
    const salt = await gerarSalt();
    await consultar("UPDATE usuarios SET salt = $2, senha_hash = $3, iteracoes_senha = $4 WHERE id = $1",
      [user.id, salt, await hashSenha(senha, salt), ITERACOES_SENHA]);
  }

  if (user.status === "pendente") return { erro: "Sua conta está aguardando aprovação do administrador." };
  if (user.status === "recusado") return { erro: "Seu cadastro foi recusado pelo administrador." };
  if (user.bloqueado) return { erro: "Seu acesso foi bloqueado temporariamente pelo administrador." };

  await transacao(async cliente => {
    await cliente.query("UPDATE usuarios SET ultimo_login = now(), ultima_atividade = now() WHERE id = $1", [user.id]);
    await registrarHistorico(cliente, "login", user, user.usuario);
  });

  return {
    usuario: {
      id: user.id, nome: user.nome, usuario: user.usuario, cargo: user.cargo,
      nivel: user.nivel, pontoId: user.pontoId, status: user.status
    }
  };
}

async function registrarAtividadeUsuario(id) {
  // Grava no máximo uma vez por minuto
  await consultar(
    `UPDATE usuarios SET ultima_atividade = now()
      WHERE id = $1 AND (ultima_atividade IS NULL OR ultima_atividade < now() - interval '1 minute')`, [idOuNulo(id)]);
}

async function alterarBloqueioUsuario(id, bloqueado, responsavel = "admin") {
  return transacao(async cliente => {
    const user = await travarUsuario(cliente, id);
    if (user.usuario === "admin") throw falha("O administrador principal não pode ser bloqueado.");
    await cliente.query("UPDATE usuarios SET bloqueado = $2 WHERE id = $1", [user.id, Boolean(bloqueado)]);
    await registrarHistorico(cliente, bloqueado ? "bloqueio temporário" : "desbloqueio", user, responsavel);
    return { id: user.id, nome: user.nome, bloqueado: Boolean(bloqueado) };
  });
}

async function alterarStatusUsuario(id, novoStatus, responsavel = "admin") {
  return transacao(async cliente => {
    const user = await travarUsuario(cliente, id);
    if (user.usuario === "admin") throw falha("Não é possível alterar a conta do Administrador principal.");
    if (novoStatus === "aprovado" && user.nivel === "operador" && !user.pontoId) {
      throw falha("Selecione o ponto de trabalho antes de aprovar o operador.");
    }
    await cliente.query("UPDATE usuarios SET status = $2 WHERE id = $1", [user.id, novoStatus]);
    await registrarHistorico(cliente, novoStatus === "aprovado" ? "aprovação" : "recusa", user, responsavel);
    return { id: user.id, nome: user.nome, usuario: user.usuario, status: novoStatus };
  });
}

async function alterarNivelUsuario(id, nivel, responsavel = "admin") {
  return transacao(async cliente => {
    const user = await travarUsuario(cliente, id);
    if (user.usuario === "admin") throw falha("O nível do administrador principal não pode ser alterado.");
    const cargo = nivel === "administrador" ? "Administrador" : "Operador";
    await cliente.query("UPDATE usuarios SET nivel = $2, cargo = $3 WHERE id = $1", [user.id, nivel, cargo]);
    await registrarHistorico(cliente, "alteração de nível", user, responsavel, `${user.nivel} para ${nivel}`);
    return { id: user.id, nome: user.nome, usuario: user.usuario, nivel, status: user.status };
  });
}

async function alterarPontoUsuario(id, pontoId, responsavel = "admin") {
  return transacao(async cliente => {
    const user = await travarUsuario(cliente, id);
    if (user.usuario === "admin") throw falha("O administrador principal não utiliza ponto operacional.");
    let ponto = null;
    if (pontoId) {
      ({ rows: [ponto] } = await cliente.query("SELECT id, nome FROM pontos WHERE id = $1", [idOuNulo(pontoId)]));
      if (!ponto) throw falha("Ponto de distribuição não encontrado.");
    }
    const { rows: [anterior] } = await cliente.query("SELECT nome FROM pontos WHERE id = $1", [user.pontoId]);
    await cliente.query("UPDATE usuarios SET ponto_id = $2 WHERE id = $1", [user.id, ponto ? ponto.id : null]);
    await registrarHistorico(cliente, "alteração de ponto", user, responsavel,
      `${anterior ? anterior.nome : "sem ponto"} para ${ponto ? ponto.nome : "sem ponto"}`);
    return { id: user.id, nome: user.nome, usuario: user.usuario, pontoId: ponto ? ponto.id : null };
  });
}

async function excluirUsuarioRecusado(id, responsavel = "admin") {
  return transacao(async cliente => {
    const user = await travarUsuario(cliente, id);
    if (user.status !== "recusado") throw falha("Somente cadastros recusados podem ser excluídos.");
    await registrarHistorico(cliente, "exclusão", user, responsavel, "Cadastro recusado removido");
    await cliente.query("DELETE FROM usuarios WHERE id = $1", [user.id]);
    return { id: user.id, nome: user.nome, usuario: user.usuario, status: user.status };
  });
}

async function listarHistoricoUsuarios() {
  const { rows } = await consultar(`
    SELECT id, acao, usuario_id AS "usuarioId", usuario_nome AS "usuarioNome", responsavel, detalhes, data
      FROM historico_usuarios ORDER BY data DESC, id DESC LIMIT 100`);
  return rows;
}

// ==========================================
// PONTOS DE DISTRIBUIÇÃO
// ==========================================
async function listarPontos() {
  const { rows } = await consultar(`
    SELECT pt.id, pt.nome, pt.localizacao,
           COUNT(p.id) AS total,
           COUNT(*) FILTER (WHERE p.status = 'livre') AS livres,
           COUNT(*) FILTER (WHERE p.status = 'locado') AS alugados,
           COUNT(*) FILTER (WHERE p.status = 'manutencao') AS manutencao,
           pt.criado_em AS "criadoEm"
      FROM pontos pt
      LEFT JOIN patinetes p ON p.ponto_id = pt.id
     GROUP BY pt.id
     ORDER BY pt.id`);
  return rows;
}

async function adicionarPonto(nome, localizacao) {
  const { rows: [ponto] } = await consultar(
    `INSERT INTO pontos (nome, localizacao) VALUES ($1, $2)
     RETURNING id, nome, localizacao, criado_em AS "criadoEm"`,
    [nome.trim(), (localizacao || "").trim() || "Sem localização"]);
  return { ...ponto, total: 0, livres: 0, alugados: 0, manutencao: 0 };
}

async function removerPonto(id) {
  return transacao(async cliente => {
    const { rows: [removido] } = await cliente.query(
      `SELECT id, nome, localizacao, criado_em AS "criadoEm" FROM pontos WHERE id = $1 FOR UPDATE`, [idOuNulo(id)]);
    if (!removido) throw falha("Ponto de distribuição não encontrado");
    // Patinetes do ponto removido vão para o primeiro ponto restante
    const { rows: [restante] } = await cliente.query("SELECT id FROM pontos WHERE id <> $1 ORDER BY id LIMIT 1", [removido.id]);
    await cliente.query("UPDATE patinetes SET ponto_id = $2 WHERE ponto_id = $1", [removido.id, restante ? restante.id : null]);
    await cliente.query("DELETE FROM pontos WHERE id = $1", [removido.id]);
    return removido;
  });
}

// ==========================================
// PATINETES
// ==========================================
async function listarPatinetes(pontoId = null) {
  const filtro = pontoId ? (idOuNulo(pontoId) ?? -1) : null;
  const { rows } = await consultar(`${SELECT_PATINETE} WHERE ($1::int IS NULL OR p.ponto_id = $1) ORDER BY p.id`, [filtro]);
  return rows;
}

async function buscarPatinetePorId(id) {
  const { rows: [patinete] } = await consultar(`${SELECT_PATINETE} WHERE p.id = $1`, [idOuNulo(id)]);
  return patinete;
}

async function adicionarPatinetes(qtd, pontoId = null) {
  return transacao(async cliente => {
    let ponto;
    if (pontoId) {
      ({ rows: [ponto] } = await cliente.query("SELECT id FROM pontos WHERE id = $1", [idOuNulo(pontoId)]));
      if (!ponto) throw falha("Ponto de distribuição não encontrado");
    } else {
      ({ rows: [ponto] } = await cliente.query("SELECT id FROM pontos ORDER BY id LIMIT 1"));
    }
    // Código PAT001, PAT002... a partir do ID gerado pelo banco
    const { rows } = await cliente.query(`
      INSERT INTO patinetes (id, codigo, ponto_id)
      SELECT n, 'PAT' || CASE WHEN n < 1000 THEN lpad(n::text, 3, '0') ELSE n::text END, $2
        FROM (SELECT nextval(pg_get_serial_sequence('patinetes', 'id'))::int AS n FROM generate_series(1, $1)) novos
      RETURNING id`, [qtd, ponto ? ponto.id : null]);
    return buscarPatinetes(cliente, rows.map(r => r.id));
  });
}

async function removerPatinete(id) {
  const [removido] = await removerPatinetes([id]);
  return removido;
}

// Remove vários patinetes de uma vez: ou todos são removidos, ou nenhum
async function removerPatinetes(listaIds) {
  const ids = [...new Set((listaIds || []).map(idOuNulo))];
  if (!ids.length) throw falha("Selecione pelo menos um patinete.");
  if (ids.includes(null)) throw falha("Patinete não encontrado");

  return transacao(async cliente => {
    const { rows: alvos } = await cliente.query(`
      SELECT p.id, p.codigo, p.status,
             EXISTS (SELECT 1 FROM locacoes l WHERE l.patinete_id = p.id AND l.status = 'ativa') AS alugado
        FROM patinetes p WHERE p.id = ANY($1::int[]) ORDER BY p.id FOR UPDATE OF p`, [ids]);
    if (alvos.length !== ids.length) throw falha(ids.length === 1 ? "Patinete não encontrado" : "Um dos patinetes selecionados não foi encontrado.");

    const alugados = alvos.filter(p => p.status === "locado" || p.alugado).map(p => p.codigo);
    const emManutencao = alvos.filter(p => p.status === "manutencao").map(p => p.codigo);
    if (alugados.length) {
      throw falha(ids.length === 1
        ? "Não é possível remover um patinete que está alugado no momento!"
        : `Não é possível remover patinetes alugados: ${alugados.join(", ")}.`);
    }
    if (emManutencao.length) {
      throw falha(ids.length === 1
        ? "Conclua a manutenção antes de remover o patinete."
        : `Conclua a manutenção antes de remover: ${emManutencao.join(", ")}.`);
    }

    const removidos = await buscarPatinetes(cliente, ids);
    await cliente.query("DELETE FROM patinetes WHERE id = ANY($1::int[])", [ids]);
    return removidos;
  });
}

async function atualizarPatinete(id, dados) {
  // Status, cliente e id só mudam pelos fluxos de locação e manutenção
  const tem = campo => Object.prototype.hasOwnProperty.call(dados || {}, campo);
  const naoPermitidos = Object.keys(dados || {}).filter(campo => !["pontoId", "pontoNome", "modelo", "bateria"].includes(campo));
  if (naoPermitidos.length) throw falha(`Campo(s) não editável(is): ${naoPermitidos.join(", ")}.`);

  return transacao(async cliente => {
    const { rows: [atual] } = await cliente.query("SELECT id FROM patinetes WHERE id = $1 FOR UPDATE", [idOuNulo(id)]);
    if (!atual) throw falha("Patinete não encontrado");

    const colunas = [];
    const valores = [atual.id];
    const definir = (coluna, valor) => {
      valores.push(valor);
      colunas.push(`${coluna} = $${valores.length}`);
    };
    if (tem("pontoId")) {
      let novoPonto = null;
      if (dados.pontoId) {
        const { rows: [ponto] } = await cliente.query("SELECT id FROM pontos WHERE id = $1", [idOuNulo(dados.pontoId)]);
        if (!ponto) throw falha("Ponto de distribuição não encontrado");
        novoPonto = ponto.id;
      }
      definir("ponto_id", novoPonto);
    }
    if (tem("modelo")) {
      const modelo = String(dados.modelo || "").trim();
      if (!modelo || modelo.length > 60 || /[<>]/.test(modelo)) throw falha("Modelo inválido.");
      definir("modelo", modelo);
    }
    if (tem("bateria")) {
      const bateria = Number(dados.bateria);
      if (!Number.isInteger(bateria) || bateria < 0 || bateria > 100) throw falha("Bateria deve ser um número inteiro entre 0 e 100.");
      definir("bateria", bateria);
    }
    if (!colunas.length) throw falha("Nenhuma alteração informada.");

    await cliente.query(`UPDATE patinetes SET ${colunas.join(", ")} WHERE id = $1`, valores);
    const [patinete] = await buscarPatinetes(cliente, [atual.id]);
    return patinete;
  });
}

// ==========================================
// CLIENTES E LOCAÇÕES
// ==========================================
async function listarLocacoes() {
  const { rows } = await consultar(`${SELECT_LOCACAO} ORDER BY l.id`);
  return rows;
}

async function listarClientes() {
  const { rows } = await consultar(`
    SELECT c.id, c.nome, c.telefone, c.criado_em AS "criadoEm",
           COUNT(l.id) AS "totalLocacoes",
           COALESCE(SUM(l.valor_total), 0) AS "totalGasto",
           MAX(l.data_inicio) AS "ultimaLocacao"
      FROM clientes c
      LEFT JOIN locacoes l ON l.cliente_id = c.id
     GROUP BY c.id
     ORDER BY c.id`);
  return rows;
}

async function obterHistoricoCliente(id) {
  const { rows: [cliente] } = await consultar(
    `SELECT id, nome, telefone, criado_em AS "criadoEm" FROM clientes WHERE id = $1`, [idOuNulo(id)]);
  if (!cliente) throw falha("Cliente não encontrado.");
  const { rows: locacoes } = await consultar(`${SELECT_LOCACAO} WHERE l.cliente_id = $1 ORDER BY l.data_inicio DESC, l.id DESC`, [cliente.id]);
  return { cliente, locacoes };
}

async function obterHistoricoPatinete(id) {
  const patinete = await buscarPatinetePorId(id);
  if (!patinete) throw falha("Patinete não encontrado.");
  const [{ rows: locacoes }, { rows: manutencoes }] = await Promise.all([
    consultar(`${SELECT_LOCACAO} WHERE l.patinete_id = $1`, [patinete.id]),
    consultar(`${SELECT_MANUTENCAO} WHERE m.patinete_id = $1`, [patinete.id])
  ]);
  const eventos = [
    ...locacoes.map(l => ({
      tipo: "locação", data: l.dataInicio, fim: l.dataFim || null, titulo: l.cliente,
      detalhes: `${l.tempoMinutos} min · R$ ${Number(l.valorTotal || 0).toFixed(2)} · ${l.status}`
    })),
    ...manutencoes.map(m => ({
      tipo: "manutenção", data: m.data, fim: m.dataLiberacao || null, titulo: m.descricao,
      detalhes: `R$ ${Number(m.valor || 0).toFixed(2)} · ${m.status}`
    }))
  ].sort((a, b) => new Date(b.data) - new Date(a.data));
  return { patinete, eventos };
}

async function iniciarLocacoes(patineteIds, cliente, telefone, tempo, valorBase, pagamento, usuarioOperador = "Operador") {
  const ids = [...new Set(patineteIds.map(idOuNulo))];
  if (!ids.length) throw falha("Selecione pelo menos um patinete.");
  if (ids.includes(null)) throw falha("Um dos patinetes selecionados não foi encontrado.");

  return transacao(async conexao => {
    // Trava os patinetes até o COMMIT: impede locação dupla
    const { rows: travados } = await conexao.query(
      "SELECT id, codigo, status FROM patinetes WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE", [ids]);
    if (travados.length !== ids.length) throw falha("Um dos patinetes selecionados não foi encontrado.");
    const indisponivel = travados.find(p => p.status !== "livre");
    if (indisponivel) throw falha(`O patinete ${indisponivel.codigo} não está mais disponível.`);

    // Cliente identificado pelo telefone (cria ou atualiza o nome)
    const nome = cliente.trim();
    const telefoneLimpo = String(telefone || "").trim();
    const digitos = telefoneLimpo.replace(/\D/g, "") || null;
    let clienteId;
    if (digitos) {
      ({ rows: [{ id: clienteId }] } = await conexao.query(
        `INSERT INTO clientes (nome, telefone, telefone_digitos) VALUES ($1, $2, $3)
         ON CONFLICT (telefone_digitos) DO UPDATE SET nome = EXCLUDED.nome, telefone = EXCLUDED.telefone
         RETURNING id`, [nome, telefoneLimpo, digitos]));
    } else {
      const { rows: [existente] } = await conexao.query(
        "SELECT id FROM clientes WHERE telefone_digitos IS NULL AND lower(nome) = lower($1) ORDER BY id LIMIT 1", [nome]);
      clienteId = existente ? existente.id
        : (await conexao.query("INSERT INTO clientes (nome) VALUES ($1) RETURNING id", [nome])).rows[0].id;
    }

    const { rows: [operador] } = await conexao.query("SELECT id, usuario FROM usuarios WHERE lower(usuario) = lower($1)", [usuarioOperador]);
    const { rows: novas } = await conexao.query(`
      INSERT INTO locacoes (patinete_id, patinete_codigo, cliente_id, ponto_id, ponto_nome, operador_id, operador_usuario,
                            tempo_minutos, valor_base, pagamento)
      SELECT p.id, p.codigo, $2, p.ponto_id, COALESCE(pt.nome, 'Sem ponto'), $3, $4, $5, $6, $7
        FROM patinetes p LEFT JOIN pontos pt ON pt.id = p.ponto_id
       WHERE p.id = ANY($1::int[])
       ORDER BY p.id
      RETURNING id`,
      [ids, clienteId, operador ? operador.id : null, operador ? operador.usuario : String(usuarioOperador).slice(0, 40),
       parseInt(tempo), parseFloat(valorBase), pagamento]);
    await conexao.query("UPDATE patinetes SET status = 'locado' WHERE id = ANY($1::int[])", [ids]);

    const { rows: locacoes } = await conexao.query(`${SELECT_LOCACAO} WHERE l.id = ANY($1::int[]) ORDER BY l.id`, [novas.map(n => n.id)]);
    return { patinetes: await buscarPatinetes(conexao, ids), locacoes };
  });
}

async function finalizarLocacao(patineteId) {
  return transacao(async conexao => {
    const { rows: [patinete] } = await conexao.query(
      "SELECT id, codigo, status, bateria FROM patinetes WHERE id = $1 FOR UPDATE", [idOuNulo(patineteId)]);
    if (!patinete) throw falha("Patinete não encontrado");

    const { rows: [ativa] } = await conexao.query(
      `SELECT id, data_inicio AS "dataInicio", tempo_minutos AS "tempoMinutos"
         FROM locacoes WHERE patinete_id = $1 AND status = 'ativa' FOR UPDATE`, [patinete.id]);
    if (!ativa || patinete.status !== "locado") throw falha(`O patinete ${patinete.codigo} não possui locação ativa.`);

    const { rows: [config] } = await conexao.query("SELECT multa_por_minuto FROM configuracoes WHERE id = 1");
    const agora = new Date();
    const multa = calcularMulta(ativa, config.multa_por_minuto, agora.getTime());
    await conexao.query(
      "UPDATE locacoes SET multa = $2, data_fim = GREATEST($3::timestamptz, data_inicio), status = 'finalizada' WHERE id = $1",
      [ativa.id, multa, agora.toISOString()]);

    const novaBateria = Math.max(10, (patinete.bateria || 100) - Math.floor(Math.random() * 8 + 5));
    await conexao.query("UPDATE patinetes SET status = 'livre', bateria = $2 WHERE id = $1", [patinete.id, novaBateria]);

    const [patineteAtualizado] = await buscarPatinetes(conexao, [patinete.id]);
    const { rows: [locacao] } = await conexao.query(`${SELECT_LOCACAO} WHERE l.id = $1`, [ativa.id]);
    return { patinete: patineteAtualizado, locacao };
  });
}

// ==========================================
// MANUTENÇÕES
// ==========================================
async function listarManutencoes() {
  const { rows } = await consultar(`${SELECT_MANUTENCAO} ORDER BY m.id`);
  return rows;
}

async function registrarManutencao(patineteId, descricao, valor, usuario = "Operador") {
  return transacao(async conexao => {
    const { rows: [patinete] } = await conexao.query(
      `SELECT p.id, p.codigo, p.status, p.ponto_id, COALESCE(pt.nome, 'Sem ponto') AS ponto_nome
         FROM patinetes p LEFT JOIN pontos pt ON pt.id = p.ponto_id
        WHERE p.id = $1 FOR UPDATE OF p`, [idOuNulo(patineteId)]);
    if (!patinete) throw falha("Patinete não encontrado");
    const { rows: [ativa] } = await conexao.query("SELECT 1 FROM locacoes WHERE patinete_id = $1 AND status = 'ativa'", [patinete.id]);
    if (patinete.status === "locado" || ativa) {
      throw falha(`O patinete ${patinete.codigo} está alugado. Finalize a locação antes de enviá-lo para manutenção.`);
    }
    if (patinete.status === "manutencao") throw falha(`O patinete ${patinete.codigo} já está em manutenção.`);

    const { rows: [autor] } = await conexao.query("SELECT id, usuario FROM usuarios WHERE lower(usuario) = lower($1)", [usuario]);
    const { rows: [{ id }] } = await conexao.query(
      `INSERT INTO manutencoes (patinete_id, patinete_codigo, ponto_id, ponto_nome, usuario_id, usuario_login, descricao, valor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [patinete.id, patinete.codigo, patinete.ponto_id, patinete.ponto_nome, autor ? autor.id : null,
       autor ? autor.usuario : String(usuario).slice(0, 40), descricao.trim(), Number(valor)]);
    await conexao.query("UPDATE patinetes SET status = 'manutencao' WHERE id = $1", [patinete.id]);

    const [patineteAtualizado] = await buscarPatinetes(conexao, [patinete.id]);
    const { rows: [manutencao] } = await conexao.query(`${SELECT_MANUTENCAO} WHERE m.id = $1`, [id]);
    return { patinete: patineteAtualizado, manutencao };
  });
}

async function atualizarManutencao(id, dados = {}) {
  return transacao(async conexao => {
    const { rows: [atual] } = await conexao.query(
      `SELECT id, patinete_id AS "patineteId", status FROM manutencoes WHERE id = $1 FOR UPDATE`, [idOuNulo(id)]);
    if (!atual) throw falha("Manutenção não encontrada.");

    const colunas = [];
    const valores = [atual.id];
    const definir = (coluna, valor) => {
      valores.push(valor);
      colunas.push(`${coluna} = $${valores.length}`);
    };

    if (dados.prioridade !== undefined) {
      if (!["baixa", "media", "urgente"].includes(dados.prioridade)) throw falha("Prioridade inválida.");
      definir("prioridade", dados.prioridade);
    }
    if (dados.diagnostico !== undefined) definir("diagnostico", String(dados.diagnostico || "").trim().slice(0, 500));
    if (dados.responsavelServico !== undefined) definir("responsavel_servico", String(dados.responsavelServico || "").trim().slice(0, 120));
    if (dados.previsaoConclusao !== undefined) {
      const previsao = dados.previsaoConclusao ? String(dados.previsaoConclusao) : null;
      if (previsao && Number.isNaN(Date.parse(previsao))) throw falha("Data de previsão inválida.");
      // Data sem fuso (campo datetime-local) é tratada como horário da operação
      valores.push(previsao, FUSO_HORARIO);
      const v = `$${valores.length - 1}`;
      const fuso = `$${valores.length}`;
      colunas.push(`previsao_conclusao = CASE
        WHEN ${v}::text IS NULL THEN NULL
        WHEN ${v}::text ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' THEN ${v}::timestamptz
        ELSE (${v}::timestamp AT TIME ZONE ${fuso}::text) END`);
    }
    if (dados.valor !== undefined) {
      const valor = Math.max(0, parseFloat(dados.valor) || 0);
      if (valor > 100000) throw falha("Valor da manutenção inválido. Informe um valor entre R$ 0,00 e R$ 100.000,00.");
      definir("valor", valor);
    }

    const concluir = dados.status === "concluida" && atual.status !== "concluida";
    if (concluir) colunas.push("status = 'concluida'", "data_liberacao = now()");
    if (colunas.length) await conexao.query(`UPDATE manutencoes SET ${colunas.join(", ")} WHERE id = $1`, valores);

    if (concluir && atual.patineteId) {
      // Libera o patinete se não houver outra manutenção aberta
      await conexao.query(`
        UPDATE patinetes p SET status = 'livre', bateria = 100
         WHERE p.id = $1 AND p.status = 'manutencao'
           AND NOT EXISTS (SELECT 1 FROM manutencoes m WHERE m.patinete_id = p.id AND m.status = 'em_manutencao')`,
        [atual.patineteId]);
    }
    const { rows: [manutencao] } = await conexao.query(`${SELECT_MANUTENCAO} WHERE m.id = $1`, [atual.id]);
    return manutencao;
  });
}

async function liberarManutencao(patineteId) {
  return transacao(async conexao => {
    const { rows: [patinete] } = await conexao.query(
      "SELECT id, codigo, status FROM patinetes WHERE id = $1 FOR UPDATE", [idOuNulo(patineteId)]);
    if (!patinete) throw falha("Patinete não encontrado");
    if (patinete.status !== "manutencao") throw falha(`O patinete ${patinete.codigo} não está em manutenção.`);

    await conexao.query("UPDATE patinetes SET status = 'livre', bateria = 100 WHERE id = $1", [patinete.id]);
    await conexao.query(`
      UPDATE manutencoes SET status = 'concluida', data_liberacao = now()
       WHERE id = (SELECT id FROM manutencoes WHERE patinete_id = $1 AND data_liberacao IS NULL ORDER BY id DESC LIMIT 1)`,
      [patinete.id]);
    const [atualizado] = await buscarPatinetes(conexao, [patinete.id]);
    return atualizado;
  });
}

// ==========================================
// CONFIGURAÇÕES E PAINEL ADMIN
// ==========================================
async function lerConfig(executor) {
  const { rows: [config] } = await executor.query(`
    SELECT nome_admin AS "nomeAdmin", cargo_admin AS "cargoAdmin", nome_empresa AS "nomeEmpresa",
           multa_por_minuto AS "multaPorMinuto", limite_patinetes_locacao AS "limitePatinetesLocacao",
           alerta_manutencao_dias AS "alertaManutencaoDias"
      FROM configuracoes WHERE id = 1`);
  const { rows: precos } = await executor.query("SELECT tempo_minutos, valor FROM precos ORDER BY tempo_minutos");
  return {
    ...config,
    precos: Object.fromEntries(precos.map(p => [p.tempo_minutos, p.valor])),
    temposDisponiveis: precos.map(p => p.tempo_minutos)
  };
}

async function obterConfig() {
  return transacao(lerConfig, { somenteLeitura: true });
}

async function salvarConfig(config) {
  return transacao(async conexao => {
    const colunas = { nomeEmpresa: "nome_empresa", multaPorMinuto: "multa_por_minuto", limitePatinetesLocacao: "limite_patinetes_locacao" };
    const definidos = Object.keys(colunas).filter(chave => config[chave] !== undefined);
    if (definidos.length) {
      await conexao.query(
        `UPDATE configuracoes SET ${definidos.map((chave, i) => `${colunas[chave]} = $${i + 1}`).join(", ")} WHERE id = 1`,
        definidos.map(chave => config[chave]));
    }
    if (Array.isArray(config.temposDisponiveis)) {
      await conexao.query("DELETE FROM precos");
      for (const tempo of config.temposDisponiveis) {
        await conexao.query("INSERT INTO precos (tempo_minutos, valor) VALUES ($1, $2)", [tempo, config.precos[tempo]]);
      }
    }
    return lerConfig(conexao);
  });
}

async function obterPainelOperacional() {
  return transacao(async c => {
    const lista = async (sql, params = []) => (await c.query(sql, params)).rows;
    const manutencoesAntigas = await lista(`${SELECT_MANUTENCAO}
      WHERE m.status = 'em_manutencao'
        AND m.data < now() - make_interval(days => (SELECT alerta_manutencao_dias FROM configuracoes WHERE id = 1))
      ORDER BY m.id`);
    const locacoesAtrasadas = await lista(`${SELECT_LOCACAO}
      WHERE l.status = 'ativa' AND l.data_inicio + make_interval(mins => l.tempo_minutos) < now()
      ORDER BY l.id`);
    const usuarios = await lista(`SELECT ${COLUNAS_USUARIO} FROM usuarios ORDER BY id`);
    const patinetesSemPonto = await lista(`${SELECT_PATINETE} WHERE p.ponto_id IS NULL ORDER BY p.id`);
    const operadores = await lista(`
      SELECT u.id, u.nome, u.usuario, u.status, u.bloqueado, u.ponto_id AS "pontoId",
             COALESCE(pt.nome, 'Sem ponto') AS "pontoNome", u.ultimo_login AS "ultimoLogin",
             COALESCE(u.ultima_atividade, u.ultimo_login) AS "ultimaAtividade",
             COALESCE(COALESCE(u.ultima_atividade, u.ultimo_login) >= now() - interval '15 minutes', false) AS online,
             (SELECT COUNT(*) FROM locacoes l
               WHERE l.operador_id = u.id OR lower(l.operador_usuario) IN (lower(u.usuario), lower(u.nome))) AS "totalLocacoes",
             (SELECT COUNT(*) FROM manutencoes m
               WHERE m.status = 'em_manutencao'
                 AND (m.usuario_id = u.id OR lower(m.usuario_login) IN (lower(u.usuario), lower(u.nome)))) AS "manutencoesAbertas"
        FROM usuarios u
        LEFT JOIN pontos pt ON pt.id = u.ponto_id
       WHERE u.nivel = 'operador'
       ORDER BY u.id`);

    return {
      alertas: {
        manutencoesAntigas,
        locacoesAtrasadas,
        operadoresSemPonto: usuarios.filter(u => u.nivel === "operador" && !u.pontoId && !u.bloqueado),
        usuariosPendentes: usuarios.filter(u => u.status === "pendente"),
        patinetesSemPonto
      },
      operadores,
      desempenho: {
        operadoresPorLocacoes: [...operadores].sort((a, b) => b.totalLocacoes - a.totalLocacoes),
        faturamentoPorPonto: await lista(
          "SELECT ponto_nome AS nome, SUM(valor_total) AS total FROM locacoes GROUP BY ponto_nome ORDER BY total DESC, nome"),
        patinetesMaisUtilizados: await lista(
          "SELECT patinete_codigo AS nome, COUNT(*) AS total FROM locacoes GROUP BY patinete_codigo ORDER BY total DESC, nome"),
        manutencoesPorPonto: await lista(
          "SELECT ponto_nome AS nome, COUNT(*) AS total FROM manutencoes GROUP BY ponto_nome ORDER BY total DESC, nome"),
        horariosMaiorMovimento: await lista(`
          SELECT to_char(data_inicio AT TIME ZONE $1, 'HH24') || ':00' AS nome, COUNT(*) AS total
            FROM locacoes GROUP BY 1 ORDER BY total DESC, nome LIMIT 8`, [FUSO_HORARIO])
      }
    };
  }, { somenteLeitura: true });
}

// ==========================================
// RELATÓRIOS
// ==========================================
// Converte o filtro do relatório em intervalo de dias (no fuso da operação):
// "atual", "anterior", "todos", "AAAA-MM" ou { inicio: "AAAA-MM-DD", fim: "AAAA-MM-DD" }
function intervaloDoPeriodo(filtro) {
  const mesAtual = mesLocal(new Date());
  const doMes = mes => {
    const [ano, m] = mes.split("-").map(Number);
    const ultimoDia = String(new Date(ano, m, 0).getDate()).padStart(2, "0");
    return { inicio: `${mes}-01`, fim: `${mes}-${ultimoDia}`, periodo: mes };
  };
  const dataValida = texto => /^\d{4}-\d{2}-\d{2}$/.test(texto || "")
    && new Date(`${texto}T12:00:00Z`).toISOString().slice(0, 10) === texto;

  if (filtro && typeof filtro === "object") {
    const { inicio, fim } = filtro;
    if (!dataValida(inicio) || !dataValida(fim)) throw falha("Informe as datas inicial e final do período.");
    if (inicio > fim) throw falha("A data inicial deve ser anterior ou igual à data final.");
    return { inicio, fim, periodo: `${inicio} a ${fim}` };
  }
  if (filtro === "todos") return { inicio: null, fim: null, periodo: "Historico Completo" };
  if (filtro === "anterior") return doMes(mesAnteriorDe(mesAtual));
  if (!filtro || filtro === "atual") return doMes(mesAtual);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(filtro)) return doMes(filtro);
  throw falha("Período inválido.");
}

async function obterResumoGeral(filtro = null) {
  const mesAtualStr = mesLocal(new Date());
  const mesAnteriorStr = mesAnteriorDe(mesAtualStr);
  const { inicio, fim, periodo } = intervaloDoPeriodo(filtro);
  // $1 = data inicial, $2 = data final (NULL = sem limite), $3 = fuso da operação
  const entre = coluna => `($1::date IS NULL OR ${coluna} >= $1::date::timestamp AT TIME ZONE $3)
    AND ($2::date IS NULL OR ${coluna} < ($2::date + 1)::timestamp AT TIME ZONE $3)`;
  const filtroLoc = entre("l.data_inicio");
  const filtroMan = entre("m.data");
  const parametros = [inicio, fim, FUSO_HORARIO];

  return transacao(async c => {
    const lista = async (sql, params = parametros) => (await c.query(sql, params)).rows;

    const [frota] = await lista(`
      SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'livre') AS livres,
             COUNT(*) FILTER (WHERE status = 'locado') AS locados,
             COUNT(*) FILTER (WHERE status = 'manutencao') AS manutencao
        FROM patinetes`, []);
    const [fin] = await lista(`
      SELECT COUNT(*) AS "totalLocacoes", COALESCE(SUM(valor_total), 0) AS faturamento,
             COALESCE(SUM(valor_total) FILTER (WHERE status = 'finalizada'), 0) AS recebido,
             COALESCE(SUM(valor_total) FILTER (WHERE status NOT IN ('finalizada', 'cancelada')), 0) AS pendente,
             COALESCE(SUM(multa), 0) AS multas,
             COALESCE(SUM(valor_total) FILTER (WHERE status = 'cancelada'), 0) AS cancelado,
             COUNT(*) FILTER (WHERE status NOT IN ('finalizada', 'cancelada')) AS "quantidadePendentes",
             COUNT(*) FILTER (WHERE status = 'cancelada') AS "quantidadeCanceladas"
        FROM locacoes l WHERE ${filtroLoc}`);
    const [{ total: gastoManutencaoTotal }] = await lista(`SELECT COALESCE(SUM(valor), 0) AS total FROM manutencoes m WHERE ${filtroMan}`);
    const [historico] = await lista("SELECT COALESCE(SUM(valor_total), 0) AS faturamento, COUNT(*) AS locacoes FROM locacoes", []);

    const meses = await lista(`
      SELECT mes, SUM(locacoes) AS locacoes, SUM(faturamento) AS faturamento, SUM(manutencao) AS manutencao FROM (
        SELECT to_char(data_inicio AT TIME ZONE $2, 'YYYY-MM') AS mes, COUNT(*) AS locacoes, SUM(valor_total) AS faturamento, 0 AS manutencao
          FROM locacoes GROUP BY 1
        UNION ALL
        SELECT to_char(data AT TIME ZONE $2, 'YYYY-MM'), 0, 0, SUM(valor) FROM manutencoes GROUP BY 1
      ) t WHERE mes = ANY($1::text[]) GROUP BY mes`, [[mesAtualStr, mesAnteriorStr], FUSO_HORARIO]);

    const dias = await lista(`
      SELECT dia, SUM(faturamento) AS faturamento, SUM(manutencao) AS manutencao, SUM(locacoes) AS locacoes FROM (
        SELECT to_char(l.data_inicio AT TIME ZONE $3, 'YYYY-MM-DD') AS dia, SUM(l.valor_total) AS faturamento, 0 AS manutencao, COUNT(*) AS locacoes
          FROM locacoes l WHERE ${filtroLoc} GROUP BY 1
        UNION ALL
        SELECT to_char(m.data AT TIME ZONE $3, 'YYYY-MM-DD'), 0, SUM(m.valor), 0
          FROM manutencoes m WHERE ${filtroMan} GROUP BY 1
      ) t GROUP BY dia ORDER BY dia`);

    const pagamentos = await lista(`
      SELECT pagamento, SUM(valor_total) AS total FROM locacoes l WHERE ${filtroLoc} GROUP BY pagamento ORDER BY pagamento`);

    const usoPorPatinete = await lista(`
      SELECT p.id, p.codigo, p.modelo, p.bateria, p.status, COALESCE(pt.nome, 'Sem ponto') AS "pontoNome",
             COALESCE(lc.total, 0) AS "totalLocacoes", COALESCE(lc.faturamento, 0) AS "faturamentoGerado",
             COALESCE(mc.gasto, 0) AS "gastoManutencao", COALESCE(lc.faturamento, 0) - COALESCE(mc.gasto, 0) AS "lucroLiquido"
        FROM patinetes p
        LEFT JOIN pontos pt ON pt.id = p.ponto_id
        LEFT JOIN (SELECT patinete_id, COUNT(*) AS total, SUM(valor_total) AS faturamento
                     FROM locacoes l WHERE ${filtroLoc} GROUP BY patinete_id) lc ON lc.patinete_id = p.id
        LEFT JOIN (SELECT patinete_id, SUM(valor) AS gasto
                     FROM manutencoes m WHERE ${filtroMan} GROUP BY patinete_id) mc ON mc.patinete_id = p.id
       ORDER BY p.id`);

    const faturamentoPorPonto = await lista(`
      SELECT COALESCE(lc.ponto_nome, mc.ponto_nome) AS "pontoNome", COALESCE(lc.locacoes, 0) AS locacoes,
             COALESCE(lc.faturamento, 0) AS faturamento, COALESCE(mc.despesas, 0) AS despesas,
             COALESCE(lc.faturamento, 0) - COALESCE(mc.despesas, 0) AS lucro
        FROM (SELECT ponto_nome, COUNT(*) AS locacoes, SUM(valor_total) AS faturamento
                FROM locacoes l WHERE ${filtroLoc} GROUP BY ponto_nome) lc
        FULL OUTER JOIN (SELECT ponto_nome, SUM(valor) AS despesas
                FROM manutencoes m WHERE ${filtroMan} GROUP BY ponto_nome) mc ON mc.ponto_nome = lc.ponto_nome
       ORDER BY faturamento DESC, "pontoNome"`);

    const desempenhoPorOperador = await lista(`
      SELECT COALESCE(lc.operador, mc.operador) AS operador, COALESCE(lc.iniciadas, 0) AS iniciadas,
             COALESCE(lc.finalizadas, 0) AS finalizadas, COALESCE(mc.abertas, 0) AS "manutencoesAbertas",
             COALESCE(lc.faturamento, 0) AS faturamento
        FROM (SELECT operador_usuario AS operador, COUNT(*) AS iniciadas,
                     COUNT(*) FILTER (WHERE status = 'finalizada') AS finalizadas, SUM(valor_total) AS faturamento
                FROM locacoes l WHERE ${filtroLoc} GROUP BY operador_usuario) lc
        FULL OUTER JOIN (SELECT usuario_login AS operador, COUNT(*) FILTER (WHERE status <> 'concluida') AS abertas
                FROM manutencoes m WHERE ${filtroMan} GROUP BY usuario_login) mc ON mc.operador = lc.operador
       ORDER BY faturamento DESC, operador`);

    const consolidarMes = chave => {
      const linha = meses.find(item => item.mes === chave) || { locacoes: 0, faturamento: 0, manutencao: 0 };
      return { locacoes: linha.locacoes, faturamento: linha.faturamento, manutencao: linha.manutencao, lucro: linha.faturamento - linha.manutencao };
    };
    const calcularVariacao = (atual, anterior) => (!anterior ? (atual ? null : 0) : ((atual - anterior) / Math.abs(anterior)) * 100);
    const atual = consolidarMes(mesAtualStr);
    const anterior = consolidarMes(mesAnteriorStr);

    return {
      periodo,
      intervalo: { inicio, fim },
      mesAtual: mesAtualStr,
      frota,
      financeiro: {
        totalLocacoes: fin.totalLocacoes,
        faturamentoTotal: fin.faturamento,
        gastoManutencaoTotal,
        lucroTotal: fin.faturamento - gastoManutencaoTotal,
        faturamentoHistorico: historico.faturamento,
        locacoesHistorico: historico.locacoes,
        pagamentos: {
          recebido: fin.recebido,
          pendente: fin.pendente,
          multas: fin.multas,
          cancelado: fin.cancelado,
          quantidadePendentes: fin.quantidadePendentes,
          quantidadeCanceladas: fin.quantidadeCanceladas
        }
      },
      comparacao: {
        mesAtual: mesAtualStr,
        mesAnterior: mesAnteriorStr,
        atual,
        anterior,
        variacoes: {
          locacoes: calcularVariacao(atual.locacoes, anterior.locacoes),
          faturamento: calcularVariacao(atual.faturamento, anterior.faturamento),
          manutencao: calcularVariacao(atual.manutencao, anterior.manutencao),
          lucro: calcularVariacao(atual.lucro, anterior.lucro)
        }
      },
      porDia: Object.fromEntries(dias.map(d => [d.dia, { faturamento: d.faturamento, manutencao: d.manutencao, locacoes: d.locacoes }])),
      porPagamento: Object.fromEntries(pagamentos.map(item => [item.pagamento, item.total])),
      faturamentoPorPonto,
      desempenhoPorOperador,
      usoPorPatinete
    };
  }, { somenteLeitura: true });
}

module.exports = {
  BancoIndisponivelError,
  mesLocal,
  diaLocal,
  calcularMulta,
  hashSenha,
  verificarSenha,
  listarUsuarios,
  buscarUsuarioPorLogin,
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
  removerPatinetes,
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
