// E-Scooter GO - Conexão com o PostgreSQL: pool, transações e tradução de erros
const { Pool, types } = require("pg");

// ==========================================
// CONVERSÃO DE TIPOS E POOL
// ==========================================

// NUMERIC e BIGINT viram número; TIMESTAMPTZ vira texto ISO 8601
types.setTypeParser(types.builtins.NUMERIC, valor => parseFloat(valor));
types.setTypeParser(types.builtins.INT8, valor => parseInt(valor, 10));
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
pool.on("error", error => console.error("Conexão ociosa com o PostgreSQL falhou:", error.message));

// ==========================================
// ERROS
// ==========================================

// Banco fora do ar: a API responde 503
class BancoIndisponivelError extends Error {
  constructor(causa) {
    super("Banco de dados indisponível. Tente novamente em instantes.");
    this.name = "BancoIndisponivelError";
    this.bancoIndisponivel = true;
    this.cause = causa;
  }
}

// Falha inesperada: a API responde 500 sem expor detalhes ao navegador
class ErroInternoBanco extends Error {
  constructor(causa) {
    super("Erro interno ao acessar o banco de dados.");
    this.name = "ErroInternoBanco";
    this.erroInterno = true;
    this.cause = causa;
  }
}

// Regra de negócio violada: a API responde 400 com a mensagem
function erroDeValidacao(mensagem) {
  const erro = new Error(mensagem);
  erro.erroDeValidacao = true;
  return erro;
}

const CODIGOS_DE_CONEXAO = new Set(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "EPIPE"]);
const MENSAGENS_RESTRICAO = {
  usuarios_login_unico: "Nome de usuário já cadastrado!",
  locacoes_uma_ativa_por_patinete: "Este patinete já possui uma locação ativa.",
  patinetes_codigo_key: "Já existe um patinete com este código."
};

// Converte erros do PostgreSQL/driver em um dos três tipos acima
function traduzirErro(error) {
  if (!error || error.bancoIndisponivel || error.erroInterno || error.erroDeValidacao) return error;
  const codigo = String(error.code || "");
  const ehErroDoPostgres = /^[0-9A-Z]{5}$/.test(codigo);

  if (CODIGOS_DE_CONEXAO.has(codigo) || /timeout|terminated|Connection terminated/i.test(error.message || "")
      || codigo.startsWith("08") || ["57P01", "57P02", "57P03", "53300", "3D000", "28P01", "28000"].includes(codigo)) {
    return new BancoIndisponivelError(error);
  }
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

function registrar(error) {
  if (error.bancoIndisponivel) console.error(`[banco] ${error.message}`, error.cause?.message || "");
  if (error.erroInterno) console.error(`[banco] ${error.message}`, error.cause?.stack || error.cause?.message || "");
  return error;
}

// ==========================================
// INICIALIZAÇÃO DO BANCO
// ==========================================

// Roda uma vez (esquema, dados iniciais, migração); se falhar, tenta de novo na próxima consulta
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

// ==========================================
// CONSULTAS E TRANSAÇÕES
// ==========================================

async function consultar(sql, parametros = []) {
  try {
    await garantirInicializado();
    return await pool.query(sql, parametros);
  } catch (error) {
    throw registrar(traduzirErro(error));
  }
}

// Executa fn(conexao) entre BEGIN e COMMIT; qualquer erro faz ROLLBACK
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
