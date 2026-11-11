// Conexão com o PostgreSQL: pool, conversão de tipos, transações e tradução
// dos erros do banco para mensagens que a API pode devolver ao usuário.
const { Pool, types } = require("pg");

// --- Conversão de tipos ----------------------------------------------------
// NUMERIC (dinheiro) e BIGINT (COUNT/SUM) chegam como texto por padrão no
// driver "pg"; a API sempre trabalhou com números.
types.setTypeParser(types.builtins.NUMERIC, valor => parseFloat(valor));
types.setTypeParser(types.builtins.INT8, valor => parseInt(valor, 10));
// TIMESTAMPTZ vira string ISO 8601 (mesmo formato que a API já devolvia).
const lerTimestampTz = types.getTypeParser(types.builtins.TIMESTAMPTZ);
types.setTypeParser(types.builtins.TIMESTAMPTZ, valor => lerTimestampTz(valor).toISOString());

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "escooter",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  max: Number(process.env.PGPOOL_MAX) || 10,
  connectionTimeoutMillis: 5000
});
// Uma conexão ociosa que cai (ex.: banco reiniciado) não pode derrubar o Node.
pool.on("error", error => console.error("Conexão ociosa com o PostgreSQL falhou:", error.message));

// --- Erros -----------------------------------------------------------------
class BancoIndisponivelError extends Error {
  constructor(causa) {
    super("Banco de dados indisponível. Tente novamente em instantes.");
    this.name = "BancoIndisponivelError";
    this.bancoIndisponivel = true;
    this.cause = causa;
  }
}

// Erro inesperado do banco (bug de SQL etc.): a rota responde 500 sem expor
// detalhes internos ao navegador.
class ErroInternoBanco extends Error {
  constructor(causa) {
    super("Erro interno ao acessar o banco de dados.");
    this.name = "ErroInternoBanco";
    this.erroInterno = true;
    this.cause = causa;
  }
}

const CODIGOS_DE_CONEXAO = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "EPIPE"]);
// Mensagens amigáveis para restrições conhecidas do esquema
const MENSAGENS_RESTRICAO = {
  usuarios_login_unico: "Nome de usuário já cadastrado!",
  locacoes_uma_ativa_por_patinete: "Este patinete já possui uma locação ativa.",
  patinetes_codigo_key: "Já existe um patinete com este código."
};

function traduzirErro(error) {
  if (!error || error.bancoIndisponivel || error.erroInterno || error.erroDeValidacao) return error;
  const codigo = String(error.code || "");
  const ehErroDoPostgres = /^[0-9A-Z]{5}$/.test(codigo);

  if (CODIGOS_DE_CONEXAO.has(codigo) || /timeout|terminated|Connection terminated/i.test(error.message || "")
      || codigo.startsWith("08") || ["57P01", "57P02", "57P03", "53300", "3D000", "28P01", "28000"].includes(codigo)) {
    return new BancoIndisponivelError(error);
  }
  // Regras de negócio usam erroDeValidacao(); qualquer outro erro do Node aqui é
  // bug (TypeError etc.): vira 500 genérico e o detalhe fica só no log.
  if (!ehErroDoPostgres) return new ErroInternoBanco(error);

  if (MENSAGENS_RESTRICAO[error.constraint]) return erroDeValidacao(MENSAGENS_RESTRICAO[error.constraint]);
  if (codigo === "23505") return erroDeValidacao("Registro duplicado.");
  if (codigo === "23503") return erroDeValidacao("Registro relacionado não encontrado.");
  if (codigo === "23514" || codigo === "23502") return erroDeValidacao("Dados inválidos para esta operação.");
  if (codigo === "22001") return erroDeValidacao("Texto maior que o permitido.");
  if (["22007", "22008"].includes(codigo)) return erroDeValidacao("Data inválida.");
  if (["22P02", "22003"].includes(codigo)) return erroDeValidacao("Valor numérico inválido.");
  if (codigo === "40001" || codigo === "40P01") return erroDeValidacao("Operação concorrente detectada. Tente novamente.");
  return new ErroInternoBanco(error);
}

function erroDeValidacao(mensagem) {
  const erro = new Error(mensagem);
  erro.erroDeValidacao = true;
  return erro;
}

// --- Inicialização preguiçosa -----------------------------------------------
// O esquema/seed/migração rodam na primeira consulta. Se o banco estiver fora
// do ar, a próxima requisição tenta de novo (o servidor sobe mesmo assim).
let inicializador = null;
let promessaInicializacao = null;
function definirInicializador(fn) {
  inicializador = fn;
}
function garantirInicializado() {
  if (!inicializador) return Promise.resolve();
  if (!promessaInicializacao) {
    promessaInicializacao = (async () => {
      const conexao = await pool.connect();
      try {
        await inicializador(conexao);
      } finally {
        conexao.release();
      }
    })().catch(error => {
      promessaInicializacao = null;
      throw error;
    });
  }
  return promessaInicializacao;
}

// --- API de acesso -----------------------------------------------------------
async function consultar(sql, parametros = []) {
  try {
    await garantirInicializado();
    return await pool.query(sql, parametros);
  } catch (error) {
    throw registrar(traduzirErro(error));
  }
}

// Executa fn(cliente) dentro de BEGIN/COMMIT; qualquer erro faz ROLLBACK.
async function transacao(fn, { somenteLeitura = false } = {}) {
  let conexao;
  try {
    await garantirInicializado();
    conexao = await pool.connect();
  } catch (error) {
    throw registrar(traduzirErro(error));
  }
  try {
    await conexao.query(somenteLeitura ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    const resultado = await fn(conexao);
    await conexao.query("COMMIT");
    return resultado;
  } catch (error) {
    await conexao.query("ROLLBACK").catch(() => {});
    throw registrar(traduzirErro(error));
  } finally {
    conexao.release();
  }
}

function registrar(error) {
  if (error.bancoIndisponivel) console.error(`[banco] ${error.message}`, error.cause?.message || "");
  if (error.erroInterno) console.error(`[banco] ${error.message}`, error.cause?.stack || error.cause?.message || "");
  return error;
}

async function encerrar() {
  await pool.end();
}

module.exports = {
  pool,
  consultar,
  transacao,
  definirInicializador,
  garantirInicializado,
  encerrar,
  traduzirErro,
  erroDeValidacao,
  BancoIndisponivelError,
  ErroInternoBanco
};
