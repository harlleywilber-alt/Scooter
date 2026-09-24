// Comunicação com a API e armazenamento local de contingência

const isFileProtocol = window.location.protocol === "file:" || !window.location.host;
const API_BASE = isFileProtocol ? "http://localhost:3000" : "";

async function apiFetch(url, opcoes = {}) {
  const headers = new Headers(opcoes.headers || {});
  const token = localStorage.getItem("authToken");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const resposta = await window["fetch"](url, { ...opcoes, headers });
  if (resposta.status === 401 && !String(url).includes("/api/auth/")) {
    localStorage.removeItem("logado");
    localStorage.removeItem("usuarioLogado");
    localStorage.removeItem("authToken");
    window.location.href = "login.html";
    throw new Error("Sua sessão expirou. Entre novamente.");
  }
  return resposta;
}

const DADOS_LOCAIS_PADRAO = {
  usuarios: [
    { id: 1, nome: "Administrador Geral", usuario: "admin", cargo: "Gestor do Sistema", nivel: "administrador", status: "aprovado" }
  ],
  pontos: [
    { id: 1, nome: "Uni goias", localizacao: "-16.691576, -49.310984" },
    { id: 2, nome: "Hidrolandia", localizacao: "Praça lago" },
    { id: 3, nome: "Teste", localizacao: "Sem localização" }
  ],
  patinetes: [
    { id: 1, codigo: "PAT001", modelo: "E-Scooter Pro Max", bateria: 100, status: "livre", pontoId: 2, pontoNome: "Hidrolandia", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null },
    { id: 10, codigo: "PAT010", modelo: "E-Scooter Pro Max", bateria: 100, status: "livre", pontoId: 1, pontoNome: "Uni goias", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null },
    { id: 2, codigo: "PAT002", modelo: "E-Scooter Pro Max", bateria: 100, status: "livre", pontoId: 2, pontoNome: "Hidrolandia", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null },
    { id: 3, codigo: "PAT003", modelo: "E-Scooter Urban", bateria: 90, status: "livre", pontoId: 2, pontoNome: "Hidrolandia", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null },
    { id: 4, codigo: "PAT004", modelo: "E-Scooter Urban", bateria: 80, status: "livre", pontoId: 2, pontoNome: "Hidrolandia", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null },
    { id: 5, codigo: "PAT005", modelo: "E-Scooter Lite", bateria: 95, status: "livre", pontoId: null, pontoNome: "Sem ponto", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null },
    { id: 6, codigo: "PAT006", modelo: "E-Scooter Lite", bateria: 100, status: "livre", pontoId: null, pontoNome: "Sem ponto", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null },
    { id: 7, codigo: "PAT007", modelo: "E-Scooter Lite", bateria: 100, status: "livre", pontoId: 3, pontoNome: "Teste", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null },
    { id: 8, codigo: "PAT008", modelo: "E-Scooter Urban", bateria: 95, status: "livre", pontoId: 3, pontoNome: "Teste", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null },
    { id: 9, codigo: "PAT009", modelo: "E-Scooter Pro Max", bateria: 100, status: "livre", pontoId: 3, pontoNome: "Teste", cliente: "", telefone: "", pagamento: "", tempo: 0, valorBase: 0, inicio: null }
  ],
  locacoes: [],
  manutencoes: []
};

function obterStoreLocal(chave, padrao) {
  try {
    const d = localStorage.getItem("escooter_" + chave);
    return d ? JSON.parse(d) : padrao;
  } catch {
    return padrao;
  }
}

function salvarStoreLocal(chave, dados) {
  try {
    localStorage.setItem("escooter_" + chave, JSON.stringify(dados));
  } catch (e) {}
}

function obterResponsavelAtual() {
  try {
    return JSON.parse(localStorage.getItem("usuarioLogado"))?.usuario || "admin";
  } catch {
    return "admin";
  }
}

function registrarHistoricoLocal(acao, usuario, responsavel = obterResponsavelAtual(), detalhes = "") {
  const historico = obterStoreLocal("historico_usuarios", []);
  historico.unshift({
    id: Date.now(), acao, usuarioId: usuario.id, usuarioNome: usuario.nome,
    responsavel, detalhes, data: new Date().toISOString()
  });
  salvarStoreLocal("historico_usuarios", historico.slice(0, 100));
}

if (!localStorage.getItem("escooter_patinetes")) {
  salvarStoreLocal("patinetes", DADOS_LOCAIS_PADRAO.patinetes);
  salvarStoreLocal("pontos", DADOS_LOCAIS_PADRAO.pontos);
  salvarStoreLocal("usuarios", DADOS_LOCAIS_PADRAO.usuarios);
}

const api = {
  // Autenticação & Gestão de Usuários
  async login(usuario, senha) {
    try {
      const res = await apiFetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, senha })
      });
      const dados = await res.json();
      if (!res.ok) {
        const erro = new Error(dados.erro || "Erro ao realizar login");
        erro.respostaDoServidor = true;
        throw erro;
      }
      localStorage.setItem("logado", "true");
      localStorage.setItem("usuarioLogado", JSON.stringify(dados.usuario));
      localStorage.setItem("authToken", dados.token);
      return dados;
    } catch (e) {
      if (e.respostaDoServidor) throw e;
      throw new Error("Não foi possível conectar ao servidor. Inicie o back-end para entrar.");
    }
  },

  async cadastro(nome, usuario, senha) {
    try {
      const res = await apiFetch(`${API_BASE}/api/auth/cadastro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, usuario, senha })
      });
      const dados = await res.json();
      if (!res.ok) throw new Error(dados.erro || "Erro ao cadastrar usuário");
      return dados;
    } catch (e) {
      if (e.message && e.message !== "Failed to fetch") throw e;
      throw new Error("Não foi possível conectar ao servidor para realizar o cadastro.");
    }
  },

  async getUsuarios() {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/usuarios`);
      if (res.ok) {
        const dados = await res.json();
        salvarStoreLocal("usuarios", dados);
        return dados;
      }
    } catch (e) {}
    return obterStoreLocal("usuarios", DADOS_LOCAIS_PADRAO.usuarios);
  },

  async atualizarStatusUsuario(id, status) {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/usuarios/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, responsavel: obterResponsavelAtual() })
      });
      if (res.ok) return await res.json();
    } catch (e) {}

    const usuarios = obterStoreLocal("usuarios", DADOS_LOCAIS_PADRAO.usuarios);
    const u = usuarios.find(user => user.id === parseInt(id));
    if (u) {
      u.status = status;
      salvarStoreLocal("usuarios", usuarios);
      registrarHistoricoLocal(status === "aprovado" ? "aprovação" : "recusa", u);
    }
    return { mensagem: `Status do usuário atualizado para '${status}'!` };
  },

  async atualizarNivelUsuario(id, nivel) {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/usuarios/${id}/nivel`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nivel, responsavel: obterResponsavelAtual() })
      });
      if (res.ok) return await res.json();
      const dados = await res.json();
      throw new Error(dados.erro || "Erro ao alterar nível");
    } catch (e) {
      if (e.message && !e.message.includes("fetch")) throw e;
    }
    const usuarios = obterStoreLocal("usuarios", DADOS_LOCAIS_PADRAO.usuarios);
    const u = usuarios.find(user => user.id === parseInt(id));
    if (!u) throw new Error("Usuário não encontrado.");
    const anterior = u.nivel || "operador";
    u.nivel = nivel;
    u.cargo = nivel === "administrador" ? "Administrador" : "Operador";
    salvarStoreLocal("usuarios", usuarios);
    registrarHistoricoLocal("alteração de nível", u, obterResponsavelAtual(), `${anterior} para ${nivel}`);
    return { mensagem: "Nível de acesso atualizado com sucesso!" };
  },

  async atualizarPontoUsuario(id, pontoId) {
    const res = await apiFetch(`${API_BASE}/api/admin/usuarios/${id}/ponto`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pontoId: pontoId ? parseInt(pontoId) : null })
    });
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || "Erro ao alterar ponto de trabalho");
    return dados;
  },

  async alterarBloqueioUsuario(id, bloqueado) {
    const res = await apiFetch(`${API_BASE}/api/admin/usuarios/${id}/bloqueio`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bloqueado })
    });
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || "Erro ao alterar bloqueio do operador");
    return dados;
  },

  async excluirUsuario(id) {
    try {
      const responsavel = encodeURIComponent(obterResponsavelAtual());
      const res = await apiFetch(`${API_BASE}/api/admin/usuarios/${id}?responsavel=${responsavel}`, { method: "DELETE" });
      if (res.ok) return await res.json();
      const dados = await res.json();
      throw new Error(dados.erro || "Erro ao excluir usuário");
    } catch (e) {
      if (e.message && !e.message.includes("fetch")) throw e;
    }
    const usuarios = obterStoreLocal("usuarios", DADOS_LOCAIS_PADRAO.usuarios);
    const index = usuarios.findIndex(user => user.id === parseInt(id));
    if (index < 0 || usuarios[index].status !== "recusado") throw new Error("Somente cadastros recusados podem ser excluídos.");
    registrarHistoricoLocal("exclusão", usuarios[index], obterResponsavelAtual(), "Cadastro recusado removido");
    usuarios.splice(index, 1);
    salvarStoreLocal("usuarios", usuarios);
    return { mensagem: "Cadastro recusado excluído com sucesso!" };
  },

  async getHistoricoUsuarios() {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/historico-usuarios`);
      if (res.ok) return await res.json();
    } catch (e) {}
    return obterStoreLocal("historico_usuarios", []);
  },

  logout() {
    localStorage.removeItem("logado");
    localStorage.removeItem("usuarioLogado");
    localStorage.removeItem("authToken");
    window.location.href = "login.html";
  },

  obterUsuarioLogado() {
    try {
      return JSON.parse(localStorage.getItem("usuarioLogado")) || { nome: "Administrador", usuario: "admin" };
    } catch {
      return { nome: "Administrador", usuario: "admin" };
    }
  },

  // Pontos de Distribuição
  async getPontos() {
    try {
      const res = await apiFetch(`${API_BASE}/api/pontos`);
      if (res.ok) {
        const dados = await res.json();
        salvarStoreLocal("pontos", dados);
        return dados;
      }
    } catch (e) {}

    const pontos = obterStoreLocal("pontos", DADOS_LOCAIS_PADRAO.pontos);
    const patinetes = obterStoreLocal("patinetes", DADOS_LOCAIS_PADRAO.patinetes);

    return pontos.map(p => {
      const bikesPonto = patinetes.filter(b => b.pontoId === p.id);
      return {
        id: p.id,
        nome: p.nome,
        localizacao: p.localizacao || "Sem localização",
        total: bikesPonto.length,
        livres: bikesPonto.filter(b => b.status === "livre").length,
        alugados: bikesPonto.filter(b => b.status === "locado" || b.status === "atrasado").length,
        manutencao: bikesPonto.filter(b => b.status === "manutencao").length
      };
    });
  },

  async adicionarPonto(nome, localizacao) {
    try {
      const res = await apiFetch(`${API_BASE}/api/pontos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, localizacao })
      });
      if (res.ok) return await res.json();
    } catch (e) {}

    const pontos = obterStoreLocal("pontos", DADOS_LOCAIS_PADRAO.pontos);
    const novo = {
      id: pontos.length ? Math.max(...pontos.map(p => p.id)) + 1 : 1,
      nome: nome.trim(),
      localizacao: (localizacao || "Sem localização").trim()
    };
    pontos.push(novo);
    salvarStoreLocal("pontos", pontos);
    return { mensagem: "Ponto cadastrado com sucesso!", ponto: novo };
  },

  async removerPonto(id) {
    try {
      const res = await apiFetch(`${API_BASE}/api/pontos/${id}`, { method: "DELETE" });
      if (res.ok) return await res.json();
    } catch (e) {}

    let pontos = obterStoreLocal("pontos", DADOS_LOCAIS_PADRAO.pontos);
    pontos = pontos.filter(p => p.id !== parseInt(id));
    salvarStoreLocal("pontos", pontos);
    return { mensagem: "Ponto removido com sucesso!" };
  },

  // Patinetes
  async getPatinetes() {
    try {
      const res = await apiFetch(`${API_BASE}/api/patinetes`);
      if (res.ok) {
        const dados = await res.json();
        salvarStoreLocal("patinetes", dados);
        return dados;
      }
    } catch (e) {}

    return obterStoreLocal("patinetes", DADOS_LOCAIS_PADRAO.patinetes);
  },

  async getHistoricoPatinete(id) {
    const res = await apiFetch(`${API_BASE}/api/patinetes/${id}/historico`);
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || "Erro ao carregar histórico do patinete");
    return dados;
  },

  async adicionarPatinetes(quantidade, pontoId = null) {
    try {
      const res = await apiFetch(`${API_BASE}/api/patinetes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantidade, pontoId })
      });
      if (res.ok) return await res.json();
    } catch (e) {}

    const patinetes = obterStoreLocal("patinetes", DADOS_LOCAIS_PADRAO.patinetes);
    const pontos = obterStoreLocal("pontos", DADOS_LOCAIS_PADRAO.pontos);

    const ultimoId = patinetes.length ? Math.max(...patinetes.map(p => p.id)) : 0;
    const qtd = parseInt(quantidade) || 1;
    const pId = pontoId ? parseInt(pontoId) : (pontos.length ? pontos[0].id : null);
    const pNome = pontos.find(p => p.id === pId)?.nome || "Sem ponto";

    for (let i = 1; i <= qtd; i++) {
      patinetes.push({
        id: ultimoId + i,
        codigo: `PAT${String(ultimoId + i).padStart(3, "0")}`,
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
        inicio: null
      });
    }

    salvarStoreLocal("patinetes", patinetes);
    return { mensagem: `${qtd} patinete(s) adicionado(s) à frota!` };
  },

  async removerPatinete(id) {
    try {
      const res = await apiFetch(`${API_BASE}/api/patinetes/${id}`, { method: "DELETE" });
      if (res.ok) return await res.json();
    } catch (e) {}

    let patinetes = obterStoreLocal("patinetes", DADOS_LOCAIS_PADRAO.patinetes);
    patinetes = patinetes.filter(p => p.id !== parseInt(id));
    salvarStoreLocal("patinetes", patinetes);
    return { mensagem: "Patinete removido com sucesso!" };
  },

  async atualizarPatinete(id, dadosPatinete) {
    try {
      const res = await apiFetch(`${API_BASE}/api/patinetes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dadosPatinete)
      });
      if (res.ok) return await res.json();
    } catch (e) {}

    const patinetes = obterStoreLocal("patinetes", DADOS_LOCAIS_PADRAO.patinetes);
    const idx = patinetes.findIndex(p => p.id === parseInt(id));
    if (idx !== -1) {
      patinetes[idx] = { ...patinetes[idx], ...dadosPatinete };
      salvarStoreLocal("patinetes", patinetes);
    }
    return { mensagem: "Patinete atualizado com sucesso!" };
  },

  // Clientes e locações
  async getClientes() {
    const res = await apiFetch(`${API_BASE}/api/clientes`);
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || "Erro ao carregar clientes");
    return dados;
  },

  async getHistoricoCliente(id) {
    const res = await apiFetch(`${API_BASE}/api/clientes/${id}/historico`);
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || "Erro ao carregar histórico do cliente");
    return dados;
  },

  // Locações
  async iniciarLocacao({ patineteIds, cliente, telefone, tempo, valorBase, pagamento }) {
    try {
      const res = await apiFetch(`${API_BASE}/api/locacoes/iniciar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patineteIds,
          cliente,
          telefone,
          tempo,
          valorBase,
          pagamento
        })
      });
      if (res.ok) return await res.json();
    } catch (e) {}

    const patinetes = obterStoreLocal("patinetes", DADOS_LOCAIS_PADRAO.patinetes);
    const locacoes = obterStoreLocal("locacoes", []);
    (patineteIds || []).forEach(patineteId => {
      const p = patinetes.find(b => b.id === parseInt(patineteId));
      if (!p) return;
      p.status = "locado";
      p.cliente = cliente;
      p.telefone = telefone;
      p.pagamento = pagamento;
      p.tempo = parseInt(tempo);
      p.valorBase = parseFloat(valorBase);
      p.inicio = new Date().toISOString();

      locacoes.push({
        id: locacoes.length + 1,
        patineteId: p.id,
        patineteCodigo: p.codigo || `PAT${p.id}`,
        pontoNome: p.pontoNome || "Hidrolandia",
        cliente,
        telefone,
        tempoMinutos: parseInt(tempo),
        valorBase: parseFloat(valorBase),
        multa: 0,
        valorTotal: parseFloat(valorBase),
        pagamento,
        usuarioOperador: this.obterUsuarioLogado().nome,
        status: "ativa",
        dataInicio: p.inicio
      });

      salvarStoreLocal("patinetes", patinetes);
      salvarStoreLocal("locacoes", locacoes);
    });

    return { mensagem: "Locação iniciada com sucesso!" };
  },

  async finalizarLocacao(patineteId, multa = 0) {
    try {
      const res = await apiFetch(`${API_BASE}/api/locacoes/finalizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patineteId, multa })
      });
      if (res.ok) return await res.json();
    } catch (e) {}

    const patinetes = obterStoreLocal("patinetes", DADOS_LOCAIS_PADRAO.patinetes);
    const locacoes = obterStoreLocal("locacoes", []);
    const p = patinetes.find(b => b.id === parseInt(patineteId));

    if (p) {
      p.status = "livre";
      p.cliente = "";
      p.telefone = "";
      p.pagamento = "";
      p.tempo = 0;
      p.valorBase = 0;
      p.inicio = null;
      p.bateria = Math.max(10, (p.bateria || 100) - 5);

      const loc = locacoes.find(l => l.patineteId === p.id && l.status === "ativa");
      if (loc) {
        loc.multa = parseFloat(multa) || 0;
        loc.valorTotal = loc.valorBase + loc.multa;
        loc.status = "finalizada";
        loc.dataFim = new Date().toISOString();
      }

      salvarStoreLocal("patinetes", patinetes);
      salvarStoreLocal("locacoes", locacoes);
    }

    return { mensagem: "Patinete devolvido com sucesso!" };
  },

  // Manutenções
  async registrarManutencao(patineteId, descricao, valor = 0) {
  try {
    const res = await apiFetch(`${API_BASE}/api/manutencoes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patineteId,
        descricao,
        valor,
        usuario: this.obterUsuarioLogado().nome
      })
    });

    const dados = await res.json();

    // Se o servidor recusou, mostra exatamente o erro do server.js
    if (!res.ok) {
      const erro = new Error(
        dados.erro || "Erro ao enviar patinete para manutenção."
      );

      erro.respostaDoServidor = true;
      throw erro;
    }

    return dados;

  } catch (e) {

    // Se o servidor respondeu com erro, NÃO usa armazenamento local
    if (e.respostaDoServidor) {
      throw e;
    }

    // Somente usa contingência se realmente não conseguiu conectar ao servidor
    console.warn("Servidor indisponível. Usando armazenamento local.", e);
  }

  // CONTINGÊNCIA LOCAL
  const patinetes = obterStoreLocal(
    "patinetes",
    DADOS_LOCAIS_PADRAO.patinetes
  );

  const manutencoes = obterStoreLocal("manutencoes", []);

  const p = patinetes.find(
    b => b.id === parseInt(patineteId)
  );

  if (p) {
    p.status = "manutencao";

    manutencoes.push({
      id: manutencoes.length + 1,
      patineteId: p.id,
      patineteCodigo: p.codigo || `PAT${p.id}`,
      pontoNome: p.pontoNome || "Ponto",
      descricao,
      valor: Number(valor) || 0,
      usuario: this.obterUsuarioLogado().nome,
      status: "em_manutencao",
      data: new Date().toISOString()
    });

    salvarStoreLocal("patinetes", patinetes);
    salvarStoreLocal("manutencoes", manutencoes);
  }

  return {
    mensagem: "Patinete enviado para manutenção!"
  };
},

  async liberarManutencao(patineteId) {
    try {
      const res = await apiFetch(`${API_BASE}/api/manutencoes/liberar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patineteId })
      });
      if (res.ok) return await res.json();
    } catch (e) {}

    const patinetes = obterStoreLocal("patinetes", DADOS_LOCAIS_PADRAO.patinetes);
    const p = patinetes.find(b => b.id === parseInt(patineteId));
    if (p) {
      p.status = "livre";
      p.bateria = 100;
      salvarStoreLocal("patinetes", patinetes);
    }
    return { mensagem: "Patinete liberado para a frota!" };
  },

  async atualizarManutencao(id, dadosManutencao) {
    const res = await apiFetch(`${API_BASE}/api/admin/manutencoes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dadosManutencao)
    });
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || "Erro ao atualizar manutenção");
    return dados;
  },

  async getConfiguracoes() {
    const res = await apiFetch(`${API_BASE}/api/configuracoes`);
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || "Erro ao carregar configurações");
    return dados;
  },

  // Relatórios
  async getResumoRelatorio(mes = null) {
    try {
      const query = mes ? `?mes=${encodeURIComponent(mes)}` : "";
      const res = await apiFetch(`${API_BASE}/api/relatorios/resumo${query}`);
      if (res.ok) return await res.json();
    } catch (e) {}

    const patinetes = obterStoreLocal("patinetes", DADOS_LOCAIS_PADRAO.patinetes);
    const locacoes = obterStoreLocal("locacoes", []);
    const manutencoes = obterStoreLocal("manutencoes", []);

    const agora = new Date();
    const mesAtualStr = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
    const mesAlvo = mes === "todos"
      ? null
      : (!mes || mes === "atual" ? mesAtualStr : mes);

    const locFiltradas = locacoes.filter(l => !mesAlvo || (l.dataInicio || "").slice(0, 7) === mesAlvo);
    const manFiltradas = manutencoes.filter(m => !mesAlvo || (m.data || "").slice(0, 7) === mesAlvo);

    const faturamentoTotal = locFiltradas.reduce((a, b) => a + (parseFloat(b.valorTotal) || 0), 0);
    const gastoManutencaoTotal = manFiltradas.reduce((a, b) => a + (parseFloat(b.valor) || 0), 0);

    const porDia = {};
    locFiltradas.forEach(l => {
      const d = (l.dataInicio || "").slice(0, 10) || mesAtualStr + "-01";
      if (!porDia[d]) porDia[d] = { faturamento: 0, manutencao: 0, locacoes: 0 };
      porDia[d].faturamento += parseFloat(l.valorTotal) || 0;
      porDia[d].locacoes += 1;
    });

    const porPagamento = {};
    locFiltradas.forEach(l => {
      const f = l.pagamento || "Outro";
      porPagamento[f] = (porPagamento[f] || 0) + (parseFloat(l.valorTotal) || 0);
    });

    return {
      periodo: mesAlvo || "Historico Completo",
      mesAtual: mesAtualStr,
      frota: {
        total: patinetes.length,
        livres: patinetes.filter(p => p.status === "livre").length,
        locados: patinetes.filter(p => p.status === "locado" || p.status === "atrasado").length,
        manutencao: patinetes.filter(p => p.status === "manutencao").length
      },
      financeiro: {
        totalLocacoes: locFiltradas.length,
        faturamentoTotal,
        gastoManutencaoTotal,
        lucroTotal: faturamentoTotal - gastoManutencaoTotal
      },
      porDia,
      porPagamento
    };
  },

  async getLocacoes() {
    try {
      const res = await apiFetch(`${API_BASE}/api/locacoes`);
      if (res.ok) return await res.json();
    } catch (e) {}
    return obterStoreLocal("locacoes", []);
  },

  async getManutencoes() {
    try {
      const res = await apiFetch(`${API_BASE}/api/manutencoes`);
      if (res.ok) return await res.json();
    } catch (e) {}
    return obterStoreLocal("manutencoes", []);
  },

  // Admin
  async getAdminStats(mes = null) {
    try {
      const query = mes ? `?mes=${encodeURIComponent(mes)}` : "";
      const res = await apiFetch(`${API_BASE}/api/admin/stats${query}`);
      if (res.ok) return await res.json();
    } catch (e) {}

    const resumo = await this.getResumoRelatorio(mes);
    return {
      periodo: resumo.periodo,
      mesAtual: resumo.mesAtual,
      perfil: { nome: "Administrador Geral", cargo: "Gestor do Sistema" },
      stats: {
        totalPatinetes: resumo.frota.total,
        totalLocacoes: resumo.financeiro.totalLocacoes,
        totalManutencao: resumo.financeiro.gastoManutencaoTotal,
        faturamentoTotal: resumo.financeiro.faturamentoTotal,
        saldo: resumo.financeiro.lucroTotal
      }
    };
  },

  async getCentralAdmin() {
    const res = await apiFetch(`${API_BASE}/api/admin/central`);
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || "Erro ao carregar a central administrativa");
    return dados;
  },

  async salvarConfiguracoes(configuracoes) {
    const res = await apiFetch(`${API_BASE}/api/admin/configuracoes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configuracoes)
    });
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || "Erro ao salvar configurações");
    return dados;
  },

  // Exportações
  async baixarArquivoAutenticado(url, nomePadrao) {
    const resposta = await apiFetch(url);
    if (!resposta.ok) throw new Error("Não foi possível exportar o arquivo.");
    const blob = await resposta.blob();
    const cabecalho = resposta.headers.get("Content-Disposition") || "";
    const nome = cabecalho.match(/filename=([^;]+)/i)?.[1]?.replace(/["']/g, "") || nomePadrao;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  },

  baixarPlanilhaFaturamento(periodo = "mes_atual", mes = null) {
    let url = `${API_BASE}/api/relatorios/exportar/faturamento?periodo=${periodo}`;
    if (mes) url += `&mes=${encodeURIComponent(mes)}`;
    return this.baixarArquivoAutenticado(url, "faturamento.csv");
  },

  baixarPlanilhaFrota() {
    return this.baixarArquivoAutenticado(`${API_BASE}/api/relatorios/exportar/frota`, "relatorio-frota.csv");
  },

  baixarPlanilhaPontos() {
    return this.baixarArquivoAutenticado(`${API_BASE}/api/relatorios/exportar/pontos`, "pontos.csv");
  }
};

if (localStorage.getItem("authToken")) {
  api.getConfiguracoes().then(configuracoes => {
    const nome = configuracoes.nomeEmpresa || "E-Scooter Go";
    document.querySelectorAll(".brand-title").forEach(elemento => { elemento.textContent = nome; });
    document.querySelectorAll(".logo-texto h1").forEach(elemento => { elemento.textContent = nome.toUpperCase(); });
  }).catch(() => {});
}
