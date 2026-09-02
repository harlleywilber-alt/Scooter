// Painel administrativo

function mostrarToastAdmin(msg) {
  const toast = document.getElementById("toastAdmin");
  if (!toast) {
    alert(msg);
    return;
  }

  toast.innerText = msg;
  toast.classList.add("show");

  clearTimeout(window.toastAdminTimeout);
  window.toastAdminTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

// Carregar estatísticas e perfil do servidor
async function carregarDadosAdmin() {
  try {
    const dados = await api.getAdminStats();
    const { perfil, stats } = dados;

    // Atualiza o cabeçalho do painel
    const adminNome = document.getElementById("adminNome");
    const adminCargo = document.getElementById("adminCargo");

    if (adminNome) adminNome.innerText = perfil.nome || "Administrador";
    if (adminCargo) adminCargo.innerText = perfil.cargo || "Gestor do Sistema";

    // Atualiza cards de métricas (valores do mês vigente)
    const statPatinetes = document.getElementById("statPatinetes");
    const statLocacoes = document.getElementById("statLocacoes");
    const statFaturamento = document.getElementById("statFaturamento");
    const statSaldo = document.getElementById("statSaldo");

    if (statPatinetes) statPatinetes.innerText = stats.totalPatinetes;
    if (statLocacoes) statLocacoes.innerText = stats.totalLocacoes;
    if (statFaturamento) statFaturamento.innerText = `R$ ${stats.faturamentoTotal.toFixed(2)}`;
    if (statSaldo) {
      statSaldo.innerText = `R$ ${stats.saldo.toFixed(2)}`;
      statSaldo.style.color = stats.saldo >= 0 ? "#22c55e" : "#ef4444";
    }
  } catch (error) {
    console.error("Erro ao carregar dados do admin:", error);
    mostrarToastAdmin("Erro ao conectar ao servidor administrativo");
  }
}

let usuariosAdmin = [];
let pontosAdmin = [];
let manutencoesAdmin = [];
let configuracoesAdmin = null;

function selecionarSecaoAdmin(secao, ajustarRolagem = true) {
  const secoes = document.querySelectorAll("[data-admin-section]");
  const botoes = document.querySelectorAll("[data-admin-menu]");
  const existe = [...botoes].some(botao => botao.dataset.adminMenu === secao);
  const secaoAtiva = existe ? secao : "visao";

  secoes.forEach(elemento => elemento.classList.toggle("active", elemento.dataset.adminSection === secaoAtiva));
  botoes.forEach(botao => {
    const ativo = botao.dataset.adminMenu === secaoAtiva;
    botao.classList.toggle("active", ativo);
    botao.setAttribute("aria-current", ativo ? "page" : "false");
  });
  const botaoAtivo = document.querySelector(`[data-admin-menu="${secaoAtiva}"] span`);
  const labelMobile = document.getElementById("adminMenuMobileLabel");
  if (labelMobile && botaoAtivo) labelMobile.textContent = botaoAtivo.textContent;
  fecharMenuAdminMobile();

  sessionStorage.setItem("secaoAdminAtiva", secaoAtiva);
  if (ajustarRolagem && window.innerWidth <= 820) {
    document.querySelector(".admin-conteudo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function alternarMenuAdminMobile() {
  const sidebar = document.querySelector(".admin-sidebar");
  const botao = document.getElementById("btnMenuAdminMobile");
  const aberto = sidebar.classList.toggle("menu-aberto");
  botao.setAttribute("aria-expanded", String(aberto));
}

function fecharMenuAdminMobile() {
  const sidebar = document.querySelector(".admin-sidebar");
  const botao = document.getElementById("btnMenuAdminMobile");
  sidebar?.classList.remove("menu-aberto");
  botao?.setAttribute("aria-expanded", "false");
}

document.addEventListener("click", evento => {
  if (window.innerWidth <= 820 && !evento.target.closest(".admin-sidebar")) fecharMenuAdminMobile();
});

function formatarDataHora(data) {
  if (!data) return "Nunca entrou";
  const valor = new Date(data);
  return Number.isNaN(valor.getTime()) ? "Não informado" : valor.toLocaleString("pt-BR");
}

async function carregarUsuarios() {
  const lista = document.getElementById("listaUsuarios");
  const contador = document.getElementById("contadorPendentes");
  if (!lista) return;

  try {
    if (!pontosAdmin.length) pontosAdmin = await api.getPontos();
    usuariosAdmin = (await api.getUsuarios()).filter(usuario => usuario.usuario !== "admin");
    const pendentes = usuariosAdmin.filter(usuario => usuario.status === "pendente").length;
    contador.textContent = `${pendentes} ${pendentes === 1 ? "pendente" : "pendentes"}`;
    const contadorMenu = document.getElementById("contadorMenuPendentes");
    if (contadorMenu) {
      contadorMenu.textContent = pendentes;
      contadorMenu.classList.toggle("sem-pendencias", pendentes === 0);
    }
    filtrarUsuarios();
  } catch (error) {
    lista.innerHTML = '<p class="usuarios-vazio">Não foi possível carregar os usuários.</p>';
    mostrarToastAdmin(error.message);
  }
}

function filtrarUsuarios() {
  const lista = document.getElementById("listaUsuarios");
  const termo = (document.getElementById("pesquisaUsuario")?.value || "").trim().toLowerCase();
  const statusFiltro = document.getElementById("filtroStatusUsuario")?.value || "todos";
  const nivelFiltro = document.getElementById("filtroNivelUsuario")?.value || "todos";
  const usuarios = usuariosAdmin.filter(usuario => {
    const correspondeTexto = `${usuario.nome} ${usuario.usuario}`.toLowerCase().includes(termo);
    const correspondeStatus = statusFiltro === "todos" || usuario.status === statusFiltro;
    const correspondeNivel = nivelFiltro === "todos" || (usuario.nivel || "operador") === nivelFiltro;
    return correspondeTexto && correspondeStatus && correspondeNivel;
  });

    if (!usuarios.length) {
      lista.innerHTML = '<p class="usuarios-vazio">Nenhum usuário cadastrado.</p>';
      return;
    }

    lista.innerHTML = usuarios.map(usuario => {
      const status = usuario.status || "pendente";
      const nivel = usuario.nivel || "operador";
      return `<article class="usuario-item">
        <div class="usuario-info">
          <strong>${escaparHtml(usuario.nome)}</strong>
          <span>@${escaparHtml(usuario.usuario)} · Cadastro: ${formatarDataHora(usuario.criadoEm)}</span>
          <span>Última entrada: ${formatarDataHora(usuario.ultimoLogin)}</span>
        </div>
        <span class="status-usuario status-${status}">${status}</span>
        <select class="nivel-usuario" aria-label="Nível de acesso" onchange="alterarNivelUsuario(${usuario.id}, this.value)">
          <option value="administrador" ${nivel === "administrador" ? "selected" : ""}>Administrador</option>
          <option value="operador" ${nivel === "operador" ? "selected" : ""}>Operador</option>
        </select>
        <select class="ponto-usuario" aria-label="Ponto de trabalho" onchange="alterarPontoUsuario(${usuario.id}, this.value)">
          <option value="" ${!usuario.pontoId ? "selected" : ""}>Sem ponto</option>
          ${pontosAdmin.map(ponto => `<option value="${ponto.id}" ${Number(usuario.pontoId) === Number(ponto.id) ? "selected" : ""}>${escaparHtml(ponto.nome)}</option>`).join("")}
        </select>
        <div class="usuario-acoes">
          <button class="btn-aprovar" ${status === "aprovado" ? "disabled" : ""} onclick="alterarStatusUsuario(${usuario.id}, 'aprovado')">Aprovar</button>
          <button class="btn-recusar" ${status === "recusado" ? "disabled" : ""} onclick="alterarStatusUsuario(${usuario.id}, 'recusado')">Recusar</button>
          ${status === "recusado" ? `<button class="btn-excluir" onclick="excluirUsuario(${usuario.id})">Excluir</button>` : ""}
        </div>
      </article>`;
    }).join("");
}

async function alterarStatusUsuario(id, status) {
  if (status === "recusado" && !window.confirm("Tem certeza de que deseja recusar este cadastro?")) return;
  try {
    const resposta = await api.atualizarStatusUsuario(id, status);
    mostrarToastAdmin(resposta.mensagem || "Status atualizado com sucesso");
    await carregarUsuarios();
    await carregarHistoricoUsuarios();
  } catch (error) {
    mostrarToastAdmin(error.message);
  }
}

async function alterarNivelUsuario(id, nivel) {
  try {
    const resposta = await api.atualizarNivelUsuario(id, nivel);
    mostrarToastAdmin(resposta.mensagem);
    await carregarUsuarios();
    await carregarHistoricoUsuarios();
  } catch (error) {
    mostrarToastAdmin(error.message);
    await carregarUsuarios();
  }
}

async function alterarPontoUsuario(id, pontoId) {
  try {
    const resposta = await api.atualizarPontoUsuario(id, pontoId || null);
    mostrarToastAdmin(resposta.mensagem);
    await carregarUsuarios();
    await carregarHistoricoUsuarios();
  } catch (error) {
    mostrarToastAdmin(error.message);
    await carregarUsuarios();
  }
}

async function excluirUsuario(id) {
  if (!window.confirm("Excluir permanentemente este cadastro recusado? Esta ação não pode ser desfeita.")) return;
  try {
    const resposta = await api.excluirUsuario(id);
    mostrarToastAdmin(resposta.mensagem);
    await carregarUsuarios();
    await carregarHistoricoUsuarios();
  } catch (error) {
    mostrarToastAdmin(error.message);
  }
}

async function carregarHistoricoUsuarios() {
  const container = document.getElementById("historicoUsuarios");
  if (!container) return;
  try {
    const historico = await api.getHistoricoUsuarios();
    if (!historico.length) {
      container.innerHTML = '<p class="usuarios-vazio">Nenhuma atividade registrada.</p>';
      return;
    }
    container.innerHTML = historico.map(item => `<article class="historico-item">
      <div><strong>${escaparHtml(item.acao)}</strong> — ${escaparHtml(item.usuarioNome || "Usuário")}</div>
      <span>${formatarDataHora(item.data)} · por ${escaparHtml(item.responsavel || "sistema")}${item.detalhes ? ` · ${escaparHtml(item.detalhes)}` : ""}</span>
    </article>`).join("");
  } catch (error) {
    container.innerHTML = '<p class="usuarios-vazio">Não foi possível carregar o histórico.</p>';
  }
}

async function carregarManutencoesAdmin() {
  const container = document.getElementById("listaManutencoesAdmin");
  const contador = document.getElementById("contadorManutencoes");
  if (!container) return;

  try {
    manutencoesAdmin = await api.getManutencoes();
    const ordenadas = [...manutencoesAdmin].sort((a, b) => new Date(b.data) - new Date(a.data));
    const abertas = ordenadas.filter(item => item.status === "em_manutencao").length;
    if (contador) contador.textContent = `${abertas} ${abertas === 1 ? "em manutenção" : "em manutenção"}`;

    if (!ordenadas.length) {
      container.innerHTML = '<p class="usuarios-vazio">Nenhuma manutenção registrada.</p>';
      return;
    }

    container.innerHTML = ordenadas.map(item => {
      const emAndamento = item.status === "em_manutencao";
      const custo = Number(item.valor || 0);
      const prioridade = item.prioridade || "media";
      return `<article class="manutencao-admin-item">
        <div class="manutencao-admin-topo">
          <strong>${escaparHtml(item.patineteCodigo || `PAT${item.patineteId}`)}</strong>
          <div class="manutencao-tags"><span class="prioridade-tag prioridade-${prioridade}">${prioridade}</span><span class="status-manutencao ${emAndamento ? "status-manutencao-aberta" : "status-manutencao-concluida"}">${emAndamento ? "Em manutenção" : "Concluída"}</span></div>
        </div>
        <p>${escaparHtml(item.descricao || "Motivo não informado")}</p>
        ${item.diagnostico ? `<p class="diagnostico-manutencao"><strong>Diagnóstico:</strong> ${escaparHtml(item.diagnostico)}</p>` : ""}
        <div class="manutencao-admin-detalhes">
          <span><i class="fa-solid fa-location-dot"></i> ${escaparHtml(item.pontoNome || "Sem ponto")}</span>
          <span><i class="fa-solid fa-user"></i> ${escaparHtml(item.usuario || "Operador")}</span>
          <span><i class="fa-solid fa-calendar"></i> ${formatarDataHora(item.data)}</span>
          ${custo > 0 ? `<span><i class="fa-solid fa-money-bill"></i> R$ ${custo.toFixed(2)}</span>` : ""}
          ${item.responsavelServico ? `<span><i class="fa-solid fa-user-gear"></i> ${escaparHtml(item.responsavelServico)}</span>` : ""}
          ${item.previsaoConclusao ? `<span><i class="fa-solid fa-calendar-check"></i> Previsão: ${formatarDataHora(item.previsaoConclusao)}</span>` : ""}
        </div>
        <div class="manutencao-admin-acoes">
          ${emAndamento ? `<button class="btn-salvar" onclick="abrirEditarManutencao(${item.id})"><i class="fa-solid fa-pen"></i> Gerenciar</button>` : ""}
          <button class="btn-reset" onclick="abrirHistoricoManutencao(${item.patineteId})"><i class="fa-solid fa-clock-rotate-left"></i> Histórico</button>
        </div>
      </article>`;
    }).join("");
  } catch (error) {
    container.innerHTML = '<p class="usuarios-vazio">Não foi possível carregar as manutenções.</p>';
  }
}

function fecharModalAdmin() {
  document.getElementById("modalAdmin").style.display = "none";
}

function abrirEditarManutencao(id) {
  const item = manutencoesAdmin.find(manutencao => manutencao.id === id);
  if (!item) return;
  document.getElementById("modalAdminContent").innerHTML = `
    <h3>Gerenciar ${escaparHtml(item.patineteCodigo || `PAT${item.patineteId}`)}</h3>
    <label>Prioridade</label>
    <select id="manPrioridade"><option value="baixa">Baixa</option><option value="media">Média</option><option value="urgente">Urgente</option></select>
    <label>Diagnóstico</label><textarea id="manDiagnostico" rows="4" maxlength="500" placeholder="Resultado da avaliação técnica">${escaparHtml(item.diagnostico || "")}</textarea>
    <label>Responsável pelo serviço</label><input id="manResponsavel" maxlength="120" value="${escaparHtml(item.responsavelServico || "")}">
    <label>Previsão de conclusão</label><input id="manPrevisao" type="datetime-local" value="${item.previsaoConclusao ? new Date(item.previsaoConclusao).toISOString().slice(0, 16) : ""}">
    <label>Custo final (R$)</label><input id="manCusto" type="number" min="0" step="0.01" value="${Number(item.valor || 0).toFixed(2)}">
    <div class="modal-actions-2"><button class="btn-salvar" onclick="salvarDetalhesManutencao(${id}, false)">Salvar</button><button class="btn-salvar" onclick="salvarDetalhesManutencao(${id}, true)">Concluir</button><button class="btn-reset" onclick="fecharModalAdmin()">Cancelar</button></div>`;
  document.getElementById("manPrioridade").value = item.prioridade || "media";
  document.getElementById("modalAdmin").style.display = "flex";
}

async function salvarDetalhesManutencao(id, concluir) {
  if (concluir && !window.confirm("Concluir a manutenção e liberar o patinete para locação?")) return;
  try {
    const resposta = await api.atualizarManutencao(id, {
      prioridade: document.getElementById("manPrioridade").value,
      diagnostico: document.getElementById("manDiagnostico").value,
      responsavelServico: document.getElementById("manResponsavel").value,
      previsaoConclusao: document.getElementById("manPrevisao").value || null,
      valor: document.getElementById("manCusto").value,
      status: concluir ? "concluida" : "em_manutencao"
    });
    fecharModalAdmin();
    mostrarToastAdmin(resposta.mensagem);
    await Promise.all([carregarManutencoesAdmin(), carregarCentralAdmin(), carregarDadosAdmin()]);
  } catch (error) { mostrarToastAdmin(error.message); }
}

async function abrirHistoricoManutencao(patineteId) {
  try {
    const dados = await api.getHistoricoPatinete(patineteId);
    document.getElementById("modalAdminContent").innerHTML = `<h3>Histórico de ${escaparHtml(dados.patinete.codigo)}</h3><div class="historico-modal-lista">${dados.eventos.length ? dados.eventos.map(evento => `<article><strong>${escaparHtml(evento.tipo)}</strong><span>${formatarDataHora(evento.data)}</span><p>${escaparHtml(evento.detalhes || evento.titulo || "")}</p></article>`).join("") : "<p>Nenhum evento registrado.</p>"}</div><button class="btn-reset" onclick="fecharModalAdmin()">Fechar</button>`;
    document.getElementById("modalAdmin").style.display = "flex";
  } catch (error) { mostrarToastAdmin(error.message); }
}

async function carregarCentralAdmin() {
  try {
    const central = await api.getCentralAdmin();
    renderizarAlertasAdmin(central.alertas);
    renderizarOperadoresAdmin(central.operadores);
    renderizarDesempenhoAdmin(central.desempenho);
  } catch (error) { mostrarToastAdmin(error.message); }
}

function renderizarAlertasAdmin(alertas) {
  const container = document.getElementById("centralAlertas");
  const grupos = [
    ["Manutenções antigas", alertas.manutencoesAntigas, "fa-screwdriver-wrench", item => `${item.patineteCodigo}: ${item.descricao}`],
    ["Locações atrasadas", alertas.locacoesAtrasadas, "fa-clock", item => `${item.patineteCodigo}: ${item.cliente}`],
    ["Operadores sem ponto", alertas.operadoresSemPonto, "fa-user", item => item.nome],
    ["Usuários pendentes", alertas.usuariosPendentes, "fa-user-plus", item => item.nome],
    ["Patinetes sem ponto", alertas.patinetesSemPonto, "fa-location-dot", item => item.codigo]
  ];
  const total = grupos.reduce((soma, grupo) => soma + grupo[1].length, 0);
  const contador = document.getElementById("contadorMenuAlertas");
  if (contador) { contador.textContent = total; contador.classList.toggle("sem-pendencias", total === 0); }
  container.innerHTML = grupos.map(([titulo, itens, icone, descricao]) => `<article class="alerta-card ${itens.length ? "com-alerta" : "sem-alerta"}"><div class="alerta-card-topo"><i class="fa-solid ${icone}"></i><strong>${titulo}</strong><b>${itens.length}</b></div>${itens.length ? `<ul>${itens.slice(0, 6).map(item => `<li>${escaparHtml(descricao(item))}</li>`).join("")}</ul>` : "<p>Nenhuma pendência.</p>"}</article>`).join("");
}

function renderizarOperadoresAdmin(operadores) {
  const container = document.getElementById("listaOperadoresAdmin");
  container.innerHTML = operadores.length ? operadores.map(item => `<article class="operador-admin-item"><div class="operador-identidade"><span class="status-online ${item.online ? "online" : "offline"}"></span><div><strong>${escaparHtml(item.nome)}</strong><small>@${escaparHtml(item.usuario)} · ${item.online ? "Online" : "Offline"}</small></div></div><div class="operador-metricas"><span><b>${item.totalLocacoes}</b> locações</span><span><b>${item.manutencoesAbertas}</b> manutenções abertas</span><span><i class="fa-solid fa-location-dot"></i> ${escaparHtml(item.pontoNome)}</span><span>Última entrada: ${formatarDataHora(item.ultimoLogin)}</span></div><button class="${item.bloqueado ? "btn-salvar" : "btn-recusar"}" onclick="alterarBloqueioOperador(${item.id}, ${!item.bloqueado})">${item.bloqueado ? "Desbloquear" : "Bloquear"}</button></article>`).join("") : '<p class="usuarios-vazio">Nenhum operador cadastrado.</p>';
}

async function alterarBloqueioOperador(id, bloquear) {
  if (bloquear && !window.confirm("Bloquear temporariamente o acesso deste operador?")) return;
  try { const resposta = await api.alterarBloqueioUsuario(id, bloquear); mostrarToastAdmin(resposta.mensagem); await Promise.all([carregarCentralAdmin(), carregarUsuarios()]); } catch (error) { mostrarToastAdmin(error.message); }
}

function renderizarDesempenhoAdmin(desempenho) {
  const container = document.getElementById("desempenhoAdmin");
  const grupos = [["Operadores com mais locações", desempenho.operadoresPorLocacoes, item => item.nome, item => item.totalLocacoes], ["Faturamento por ponto", desempenho.faturamentoPorPonto, item => item.nome, item => `R$ ${Number(item.total).toFixed(2)}`], ["Patinetes mais utilizados", desempenho.patinetesMaisUtilizados, item => item.nome, item => item.total], ["Pontos com mais manutenções", desempenho.manutencoesPorPonto, item => item.nome, item => item.total], ["Horários de maior movimento", desempenho.horariosMaiorMovimento, item => item.nome, item => item.total]];
  container.innerHTML = grupos.map(([titulo, itens, nome, valor]) => `<article class="ranking-card"><h4>${titulo}</h4>${itens.length ? `<ol>${itens.slice(0, 8).map(item => `<li><span>${escaparHtml(nome(item))}</span><b>${valor(item)}</b></li>`).join("")}</ol>` : "<p class='usuarios-vazio'>Sem dados.</p>"}</article>`).join("");
}

async function carregarConfiguracoesSistema() {
  try {
    configuracoesAdmin = await api.getConfiguracoes();
    document.getElementById("configNomeEmpresa").value = configuracoesAdmin.nomeEmpresa || "";
    document.getElementById("configMulta").value = configuracoesAdmin.multaPorMinuto;
    document.getElementById("configLimite").value = configuracoesAdmin.limitePatinetesLocacao;
    document.getElementById("configTempos").value = configuracoesAdmin.temposDisponiveis.join(", ");
    renderizarCamposPrecos();
  } catch (error) { mostrarToastAdmin(error.message); }
}

function obterTemposConfigurados() {
  return [...new Set(document.getElementById("configTempos").value.split(",").map(valor => parseInt(valor.trim())).filter(valor => valor > 0))].sort((a, b) => a - b);
}

function renderizarCamposPrecos() {
  const tempos = obterTemposConfigurados();
  document.getElementById("configPrecos").innerHTML = tempos.map(tempo => `<label>${tempo} minutos<input class="config-preco-input" data-tempo="${tempo}" type="number" min="0.01" step="0.01" value="${Number(configuracoesAdmin?.precos?.[tempo] || 0).toFixed(2)}"></label>`).join("");
}

async function salvarConfiguracoesSistema() {
  const tempos = obterTemposConfigurados();
  const precos = Object.fromEntries([...document.querySelectorAll(".config-preco-input")].map(input => [input.dataset.tempo, Number(input.value)]));
  try {
    const resposta = await api.salvarConfiguracoes({ nomeEmpresa: document.getElementById("configNomeEmpresa").value, multaPorMinuto: document.getElementById("configMulta").value, limitePatinetesLocacao: document.getElementById("configLimite").value, temposDisponiveis: tempos, precos });
    configuracoesAdmin = resposta.configuracoes;
    mostrarToastAdmin(resposta.mensagem);
    renderizarCamposPrecos();
  } catch (error) { mostrarToastAdmin(error.message); }
}

function logoutAdmin() {
  api.logout();
}

// INICIALIZAÇÃO
selecionarSecaoAdmin(sessionStorage.getItem("secaoAdminAtiva") || "visao", false);
document.getElementById("configTempos")?.addEventListener("change", renderizarCamposPrecos);
carregarDadosAdmin();
carregarUsuarios();
carregarHistoricoUsuarios();
carregarManutencoesAdmin();
carregarCentralAdmin();
carregarConfiguracoesSistema();
