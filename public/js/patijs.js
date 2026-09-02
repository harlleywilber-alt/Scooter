// Controle da frota

const STATUS = {
  LIVRE: "livre",
  LOCADO: "locado",
  MANUTENCAO: "manutencao",
  ATRASADO: "atrasado"
};

let configuracoesSistema = {
  nomeEmpresa: "E-Scooter Go",
  precos: { 15: 20, 30: 30, 45: 45 },
  temposDisponiveis: [15, 30, 45],
  multaPorMinuto: 1,
  limitePatinetesLocacao: 5
};

let bikes = [];
let pontosDisponiveis = [];
let bloqueado = false;
const grid = document.getElementById("grid");

function mostrarToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.innerText = msg;
  toast.classList.add("show");

  clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

function fecharModal() {
  const modal = document.getElementById("modal");
  if (modal) modal.style.display = "none";
}

window.onclick = function (e) {
  if (e.target.id === "modal") fecharModal();
};

// Carregar dados reais do servidor / banco de dados
async function carregarDadosDoServidor() {
  try {
    const [patinetes, pontos, configuracoes] = await Promise.all([
      api.getPatinetes(),
      usuarioEhAdministrador() ? api.getPontos() : Promise.resolve([]),
      api.getConfiguracoes()
    ]);

    bikes = patinetes.map(p => ({
      ...p,
      inicio: p.inicio ? new Date(p.inicio).getTime() : null
    }));

    pontosDisponiveis = pontos;
    configuracoesSistema = { ...configuracoesSistema, ...configuracoes };
    document.querySelectorAll(".brand-title").forEach(elemento => { elemento.textContent = configuracoesSistema.nomeEmpresa; });

    atualizarContadores();
    render();
  } catch (error) {
    console.error("Erro ao carregar dados:", error);
    mostrarToast("Erro ao conectar ao servidor de dados");
  }
}

// ADICIONAR PATINETES
async function abrirModalAdicionarPatinetes() {
  try {
    pontosDisponiveis = await api.getPontos();
  } catch (e) {}

  let opcoesPontos = '<option value="">Selecione o ponto de distribuição</option>';
  pontosDisponiveis.forEach(p => {
    opcoesPontos += `<option value="${p.id}">${p.nome} (${p.localizacao || "Ponto"})</option>`;
  });

  const c = document.getElementById("modalContent");
  c.innerHTML = `
    <h3><i class="fa-solid fa-plus"></i> Adicionar Patinetes</h3>
    <p class="modal-subtitle" style="color:var(--muted); margin-bottom:15px;">Informe quantos veículos deseja adicionar à frota.</p>
    
    <input id="qtdAdicionarPatinetes" type="number" min="1" max="50" value="1" placeholder="Quantidade">
    
    <select id="pontoAdicionarPatinetes">
      ${opcoesPontos}
    </select>

    <div class="modal-actions-2">
      <button class="btn-modal-green" onclick="confirmarAdicionarPatinetes()">Confirmar</button>
      <button class="btn-modal-gray" onclick="fecharModal()">Cancelar</button>
    </div>
  `;
  document.getElementById("modal").style.display = "flex";
}

async function confirmarAdicionarPatinetes() {
  const qtd = parseInt(document.getElementById("qtdAdicionarPatinetes").value);
  const pontoId = document.getElementById("pontoAdicionarPatinetes").value;

  if (!qtd || qtd <= 0) {
    mostrarToast("Informe uma quantidade válida");
    return;
  }

  try {
    const res = await api.adicionarPatinetes(qtd, pontoId || null);
    fecharModal();
    mostrarToast(res.mensagem || "Patinetes adicionados com sucesso!");
    await carregarDadosDoServidor();
  } catch (error) {
    mostrarToast(error.message);
  }
}

// REMOVER PATINETE
function abrirModalRemoverPatinete() {
  const c = document.getElementById("modalContent");
  c.innerHTML = `
    <h3><i class="fa-solid fa-minus"></i> Remover Patinete</h3>
    <p class="modal-subtitle" style="color:var(--muted); margin-bottom:15px;">Digite o número do patinete que deseja remover.</p>
    <input id="idRemoverPatinete" type="number" min="1" placeholder="Número do patinete (ex: 1)">
    <div class="modal-actions-2">
      <button class="btn-modal-green" style="background:var(--red) !important;" onclick="confirmarRemoverPatinete()">Remover</button>
      <button class="btn-modal-gray" onclick="fecharModal()">Cancelar</button>
    </div>
  `;
  document.getElementById("modal").style.display = "flex";
}

async function confirmarRemoverPatinete() {
  const id = parseInt(document.getElementById("idRemoverPatinete").value);
  if (!id) {
    mostrarToast("Informe um número válido");
    return;
  }

  try {
    const res = await api.removerPatinete(id);
    fecharModal();
    mostrarToast(res.mensagem || "Patinete removido com sucesso!");
    await carregarDadosDoServidor();
  } catch (error) {
    mostrarToast(error.message);
  }
}

// Opções do patinete
function abrirOpcoesPatinete(id) {
  const b = bikes.find(x => x.id === id);
  if (!b) return;

  const m = document.getElementById("modal");
  const c = document.getElementById("modalContent");

  const opcoesAdministrador = usuarioEhAdministrador() ? `
      <button class="btn-modal-purple" onclick="abrirModalMudarPonto(${id})">Mudar Ponto de Distribuição</button>
      <button class="btn-modal-gray" onclick="abrirHistoricoPatinete(${id})">Ver histórico completo</button>` : "";

  c.innerHTML = `
    <h3>Patinete ${b.id}</h3>
    
    <div class="modal-opcoes-list">
      <button class="btn-modal-green" onclick="abrirLocacao(${id})">Iniciar locação</button>
      <button class="btn-modal-green" onclick="abrirModalManutencao(${id})">Enviar para manutenção</button>
      ${opcoesAdministrador}
      <button class="btn-modal-gray" onclick="fecharModal()">Cancelar</button>
    </div>
  `;

  m.style.display = "flex";
}

function formatarDataHistorico(data) {
  if (!data) return "Não informado";
  const valor = new Date(data);
  return Number.isNaN(valor.getTime()) ? "Não informado" : valor.toLocaleString("pt-BR");
}

async function abrirHistoricoPatinete(id) {
  const modal = document.getElementById("modal");
  const conteudo = document.getElementById("modalContent");
  modal.style.display = "flex";
  conteudo.innerHTML = "<h3>Histórico do patinete</h3><p>Carregando...</p>";
  try {
    const dados = await api.getHistoricoPatinete(id);
    conteudo.innerHTML = `
      <h3>Histórico de ${dados.patinete.codigo}</h3>
      <p class="modal-subtitle">Locações e manutenções registradas para este patinete.</p>
      <div class="historico-operacional">
        ${dados.eventos.length ? dados.eventos.map(evento => `<article>
          <strong>${escaparHtml(evento.tipo)} — ${escaparHtml(evento.titulo)}</strong>
          <span>${formatarDataHistorico(evento.data)}</span>
          <p>${escaparHtml(evento.detalhes)}</p>
        </article>`).join("") : "<p>Nenhum evento registrado.</p>"}
      </div>
      <button class="btn-modal-gray" onclick="abrirOpcoesPatinete(${id})">Voltar</button>`;
  } catch (error) {
    conteudo.innerHTML = `<h3>Histórico do patinete</h3><p>${error.message}</p><button class="btn-modal-gray" onclick="fecharModal()">Fechar</button>`;
  }
}

async function abrirClientes() {
  const modal = document.getElementById("modal");
  const conteudo = document.getElementById("modalContent");
  modal.style.display = "flex";
  conteudo.innerHTML = "<h3>Clientes</h3><p>Carregando...</p>";
  try {
    const clientes = await api.getClientes();
    conteudo.innerHTML = `
      <h3>Clientes</h3>
      <p class="modal-subtitle">Cadastro automático baseado nas locações.</p>
      <input id="pesquisaCliente" type="search" placeholder="Pesquisar cliente ou telefone" oninput="filtrarListaClientes()">
      <div class="clientes-lista" id="listaClientesModal">
        ${clientes.length ? clientes.map(cliente => `<button class="cliente-item" data-busca="${escaparHtml(`${cliente.nome} ${cliente.telefone}`.toLowerCase())}" onclick="abrirHistoricoCliente(${cliente.id})">
          <strong>${escaparHtml(cliente.nome)}</strong><span>${escaparHtml(cliente.telefone || "Sem telefone")}</span>
          <small>${cliente.totalLocacoes} locação(ões) · R$ ${Number(cliente.totalGasto).toFixed(2)}</small>
        </button>`).join("") : "<p>Nenhum cliente cadastrado.</p>"}
      </div>
      <button class="btn-modal-gray" onclick="fecharModal()">Fechar</button>`;
  } catch (error) {
    mostrarToast(error.message);
    fecharModal();
  }
}

function filtrarListaClientes() {
  const termo = document.getElementById("pesquisaCliente").value.trim().toLowerCase();
  document.querySelectorAll(".cliente-item").forEach(item => {
    item.style.display = item.dataset.busca.includes(termo) ? "flex" : "none";
  });
}

async function abrirHistoricoCliente(id) {
  const conteudo = document.getElementById("modalContent");
  conteudo.innerHTML = "<h3>Histórico do cliente</h3><p>Carregando...</p>";
  try {
    const dados = await api.getHistoricoCliente(id);
    conteudo.innerHTML = `
      <h3>${escaparHtml(dados.cliente.nome)}</h3>
      <p class="modal-subtitle">${escaparHtml(dados.cliente.telefone || "Sem telefone cadastrado")}</p>
      <div class="historico-operacional">
        ${dados.locacoes.length ? dados.locacoes.map(locacao => `<article>
          <strong>${escaparHtml(locacao.patineteCodigo)} — ${escaparHtml(locacao.pontoNome)}</strong>
          <span>${formatarDataHistorico(locacao.dataInicio)}</span>
          <p>${locacao.tempoMinutos} min · ${escaparHtml(locacao.pagamento)} · R$ ${Number(locacao.valorTotal).toFixed(2)} · ${escaparHtml(locacao.status)}</p>
        </article>`).join("") : "<p>Nenhuma locação registrada.</p>"}
      </div>
      <button class="btn-modal-gray" onclick="abrirClientes()">Voltar aos clientes</button>`;
  } catch (error) {
    mostrarToast(error.message);
    abrirClientes();
  }
}

// ==========================================
// INICIAR LOCAÇÃO DIRETA (BOTÃO DA BARRA)
// ==========================================
async function abrirNovaLocacaoGeral() {
  await carregarDadosDoServidor();
  const livres = bikes.filter(b => b.status === STATUS.LIVRE);
  if (livres.length === 0) {
    mostrarToast("Nenhum patinete disponível para locação no momento");
    return;
  }
  abrirLocacao(livres[0].id);
}

// Nova locação
function abrirLocacao(id) {
  const b = bikes.find(x => x.id === id);
  if (!b) return;
  const disponiveis = bikes.filter(bike => bike.status === STATUS.LIVRE);

  const c = document.getElementById("modalContent");

  c.innerHTML = `
    <h3>Nova locação</h3>
    
    <input id="clienteNome" placeholder="Nome do cliente">
    <input id="clienteTelefone" placeholder="Telefone com DDD">
    
    <select id="tempoAlugado">
      <option value="">Selecione o tempo</option>
      ${configuracoesSistema.temposDisponiveis.map(tempo => `<option value="${tempo}">${tempo} min - R$ ${Number(configuracoesSistema.precos[tempo] || 0).toFixed(2)}</option>`).join("")}
    </select>

    <div class="selecao-patinetes-titulo">
      <strong>Selecione os patinetes</strong>
    </div>
    <div class="selecao-patinetes">
      ${disponiveis.map(bike => `<label class="patinete-check">
        <input class="patinete-locacao-check" type="checkbox" value="${bike.id}" ${bike.id === id ? "checked" : ""}>
        <span>${bike.id}</span>
      </label>`).join("")}
    </div>

    <select id="formaPagamento">
      <option value="">Selecione o pagamento</option>
      <option value="Pix">Pix</option>
      <option value="Cartão de Crédito">Cartão de Crédito</option>
      <option value="Cartão de Débito">Cartão de Débito</option>
      <option value="Dinheiro">Dinheiro</option>
    </select>

    <div class="modal-actions-2">
      <button class="btn-modal-green" id="btnConfirmarLoc" onclick="confirmarLocacao()">Confirmar locação</button>
      <button class="btn-modal-gray" onclick="fecharModal()">Cancelar</button>
    </div>
  `;

  document.getElementById("modal").style.display = "flex";
}

function obterPatinetesSelecionados() {
  return [...document.querySelectorAll(".patinete-locacao-check:checked")].map(input => parseInt(input.value));
}

async function confirmarLocacao() {
  const nome = document.getElementById("clienteNome").value.trim();
  const telefone = document.getElementById("clienteTelefone").value.trim();
  const tempo = parseInt(document.getElementById("tempoAlugado").value);
  const pagamento = document.getElementById("formaPagamento").value;
  const patineteIds = obterPatinetesSelecionados();

  if (!nome || nome.length < 2) return mostrarToast("Informe o nome do cliente");
  if (!telefone || telefone.replace(/\D/g, "").length < 10) {
    return mostrarToast("Informe um telefone válido com DDD");
  }
  if (!tempo) return mostrarToast("Selecione o tempo da locação");
  if (!pagamento) return mostrarToast("Selecione a forma de pagamento");
  if (!patineteIds.length) return mostrarToast("Selecione pelo menos um patinete");
  if (patineteIds.length > Number(configuracoesSistema.limitePatinetesLocacao || 5)) {
    return mostrarToast(`Selecione no máximo ${configuracoesSistema.limitePatinetesLocacao || 5} patinetes`);
  }

  const btn = document.getElementById("btnConfirmarLoc");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Iniciando...";
  }

  try {
    const valorBase = Number(configuracoesSistema.precos[tempo]);
    const res = await api.iniciarLocacao({
      patineteIds,
      cliente: nome,
      telefone,
      tempo,
      valorBase,
      pagamento
    });

    fecharModal();
    mostrarToast(`${patineteIds.length} locação(ões) iniciada(s) com sucesso!`);
    await carregarDadosDoServidor();
  } catch (error) {
    mostrarToast(error.message);
  }
}

// ==========================================
// MODAL MUDAR PONTO DE DISTRIBUIÇÃO
// ==========================================
async function abrirModalMudarPonto(id) {
  const b = bikes.find(x => x.id === id);
  if (!b) return;

  try {
    pontosDisponiveis = await api.getPontos();
  } catch (e) {}

  let opcoesPontos = `<option value="" ${!b.pontoId ? "selected" : ""}>Sem ponto</option>`;
  pontosDisponiveis.forEach(p => {
    const selecionado = b.pontoId === p.id ? "selected" : "";
    opcoesPontos += `<option value="${p.id}" ${selecionado}>${p.nome} (${p.localizacao || "Ponto"})</option>`;
  });

  const c = document.getElementById("modalContent");
  c.innerHTML = `
    <h3>Mudar Ponto de Distribuição</h3>
    <p class="modal-subtitle" style="color:var(--muted); margin-bottom:15px;">
      Patinete <b>${b.id}</b> • Ponto atual: <b>${b.pontoNome || "Sem ponto"}</b>
    </p>

    <select id="novoPontoSelect">
      ${opcoesPontos}
    </select>

    <div class="modal-actions-2">
      <button class="btn-modal-purple" onclick="confirmarMudarPonto(${id})">Salvar Alteração</button>
      <button class="btn-modal-gray" onclick="abrirOpcoesPatinete(${id})">Voltar</button>
    </div>
  `;
}

async function confirmarMudarPonto(id) {
  const select = document.getElementById("novoPontoSelect");
  const pontoId = select.value ? parseInt(select.value) : null;

  const ponto = pontosDisponiveis.find(p => p.id === pontoId);
  const pontoNome = ponto ? ponto.nome : "Sem ponto";

  try {
    await api.atualizarPatinete(id, { pontoId, pontoNome });
    fecharModal();
    mostrarToast(pontoId
      ? `Patinete ${id} transferido para '${pontoNome}' com sucesso!`
      : `Patinete ${id} removido do ponto de distribuição.`);
    await carregarDadosDoServidor();
  } catch (error) {
    mostrarToast(error.message);
  }
}

// ==========================================
// FINALIZAR LOCAÇÃO (DEVOLUÇÃO)
// ==========================================
function calcularTempoRestante(bike) {
  if (!bike.inicio) return 0;
  return bike.inicio + bike.tempo * 60000 - Date.now();
}

function calcularValorAtual(bike) {
  const restante = calcularTempoRestante(bike);
  if (restante >= 0) return { base: bike.valorBase, multa: 0, total: bike.valorBase };

  const atrasoMin = Math.floor(Math.abs(restante) / 60000);
  const multa = atrasoMin * Number(configuracoesSistema.multaPorMinuto || 0);
  return { base: bike.valorBase, multa, total: bike.valorBase + multa };
}

function abrirFinalizarLocacao(id) {
  const b = bikes.find(x => x.id === id);
  if (!b) return;

  const { base, multa, total } = calcularValorAtual(b);
  const c = document.getElementById("modalContent");

  c.innerHTML = `
    <h3>Devolução de Patinete</h3>
    <p style="margin-bottom:6px;"><strong>Patinete:</strong> Patinete ${b.id}</p>
    <p style="margin-bottom:6px;"><strong>Ponto de Origem:</strong> ${b.pontoNome || "Ponto Geral"}</p>
    <p style="margin-bottom:6px;"><strong>Cliente:</strong> ${b.cliente}</p>
    <p style="margin-bottom:6px;"><strong>Valor Base:</strong> R$ ${base.toFixed(2)}</p>
    <p style="margin-bottom:6px;"><strong>Acréscimo por Atraso:</strong> <span style="color:${multa > 0 ? '#ef4444' : '#10b981'}; font-weight:bold;">R$ ${multa.toFixed(2)}</span></p>
    <p style="font-size:1.2rem; margin: 12px 0;"><strong>Total a Cobrar:</strong> <b style="color:#6366f1;">R$ ${total.toFixed(2)}</b></p>
    
    <div class="modal-actions-2">
      <button class="btn-modal-green" onclick="confirmarFinalizarLocacao(${id}, ${multa})">Confirmar Devolução</button>
      <button class="btn-modal-gray" onclick="fecharModal()">Cancelar</button>
    </div>
  `;

  document.getElementById("modal").style.display = "flex";
}

async function confirmarFinalizarLocacao(id, multa) {
  try {
    const res = await api.finalizarLocacao(id, multa);
    fecharModal();
    mostrarToast(res.mensagem || "Patinete devolvido com sucesso!");
    await carregarDadosDoServidor();
  } catch (error) {
    mostrarToast(error.message);
  }
}

// ==========================================
// MANUTENÇÃO
// ==========================================
function abrirModalManutencao(id) {
  const b = bikes.find(x => x.id === id);
  const c = document.getElementById("modalContent");
  const campoValor = usuarioEhAdministrador()
    ? '<input id="valorManutencao" type="number" min="0" step="0.01" placeholder="Valor gasto estimado (R$)">' 
    : "";

  c.innerHTML = `
    <h3>Enviar para Manutenção</h3>
    <p class="modal-subtitle" style="color:var(--muted); margin-bottom:15px;">Patinete ${b.id} (${b.pontoNome || "Ponto"})</p>
    <input id="motivoManutencao" placeholder="Motivo da manutenção (ex: Freio, Pneu, Bateria)">
    ${campoValor}
    
    <div class="modal-actions-2">
      <button class="btn-modal-green" onclick="confirmarEnviarManutencao(${id})">Salvar Manutenção</button>
      <button class="btn-modal-gray" onclick="fecharModal()">Cancelar</button>
    </div>
  `;
}

async function confirmarEnviarManutencao(id) {
  const descricao = document.getElementById("motivoManutencao").value.trim();
  const campoValor = document.getElementById("valorManutencao");
  const valor = campoValor ? parseFloat(campoValor.value) || 0 : 0;

  if (!descricao || descricao.length < 3) {
    return mostrarToast("Informe o motivo da manutenção");
  }

  try {
    const res = await api.registrarManutencao(id, descricao, valor);
    fecharModal();
    mostrarToast(res.mensagem || "Patinete enviado para manutenção!");
    await carregarDadosDoServidor();
  } catch (error) {
    mostrarToast(error.message);
  }
}

function abrirLiberarManutencao(id) {
  const b = bikes.find(x => x.id === id);
  const c = document.getElementById("modalContent");

  c.innerHTML = `
    <h3>Liberar da Manutenção</h3>
    <p class="modal-subtitle" style="color:var(--muted); margin-bottom:15px;">Patinete ${b.id}</p>
    <p>O patinete será marcado como <b>Disponível</b> e bateria recarregada para <b>100%</b>.</p>
    
    <div class="modal-actions-2" style="margin-top:20px;">
      <button class="btn-modal-green" onclick="confirmarLiberarManutencao(${id})">Confirmar e Liberar</button>
      <button class="btn-modal-gray" onclick="fecharModal()">Cancelar</button>
    </div>
  `;
  document.getElementById("modal").style.display = "flex";
}

async function confirmarLiberarManutencao(id) {
  try {
    const res = await api.liberarManutencao(id);
    fecharModal();
    mostrarToast(res.mensagem || "Patinete liberado para a frota!");
    await carregarDadosDoServidor();
  } catch (error) {
    mostrarToast(error.message);
  }
}

// Atualização dos cards
function atualizarContadores() {
  const qtdLivre = document.getElementById("qtdLivre");
  const qtdLocado = document.getElementById("qtdLocado");
  const qtdManutencao = document.getElementById("qtdManutencao");

  if (qtdLivre) {
    qtdLivre.innerText = bikes.filter(b => b.status === STATUS.LIVRE).length;
  }

  if (qtdLocado) {
    qtdLocado.innerText = bikes.filter(
      b => b.status === STATUS.LOCADO || b.status === STATUS.ATRASADO
    ).length;
  }

  if (qtdManutencao) {
    qtdManutencao.innerText = bikes.filter(b => b.status === STATUS.MANUTENCAO).length;
  }
}

function render() {
  const modal = document.getElementById("modal");
  if ((modal && modal.style.display === "flex") || bloqueado || !grid) return;

  grid.innerHTML = "";

  // Ordena patinetes pelo ID numérico
  const bikesOrdenadas = [...bikes].sort((a, b) => a.id - b.id);
  const total = bikesOrdenadas.length;

  const contador = document.getElementById("contadorResultados");
  if (contador) contador.innerText = `${total} resultado(s)`;

  bikesOrdenadas.forEach(b => {
    const restante = calcularTempoRestante(b);

    if (b.status === STATUS.LOCADO && restante <= 0) {
      b.status = STATUS.ATRASADO;
    }

    const card = document.createElement("div");
    card.classList.add("bike", "card-" + b.status);

    const nomePonto = (b.pontoNome || "SEM PONTO").toUpperCase();

    let html = `
      <div class="bike-card-top">
        <div class="bike-id-area">
          <i class="fa-solid fa-bicycle"></i>
          <span>${b.id}</span>
        </div>
        <span class="tag-ponto">
          <i class="fa-solid fa-location-dot"></i> ${nomePonto}
        </span>
      </div>

      <h4>Patinete ${b.id}</h4>
    `;

    if (b.status === STATUS.LIVRE) {
      html += `<div class="status-desc">Disponível para locação</div>`;
      card.onclick = () => abrirOpcoesPatinete(b.id);
    } else if (b.status === STATUS.LOCADO || b.status === STATUS.ATRASADO) {
      const min = Math.floor(Math.abs(restante) / 60000);
      const seg = Math.floor((Math.abs(restante) % 60000) / 1000);
      const porcentagem = b.tempo > 0
        ? Math.max(0, Math.min(100, (restante / (b.tempo * 60000)) * 100))
        : 0;

      html += `
        <div style="margin-top: 4px; font-size: 13px;"><strong>${b.status === STATUS.ATRASADO ? "Atrasado" : "Alugado"}</strong></div>
        <small style="color:var(--muted); display:block; font-size:12px;">Cliente: ${b.cliente}</small>
        <div class="timer" style="color: ${b.status === STATUS.ATRASADO ? '#f87171' : '#34d399'}">
          ${restante >= 0 ? "⏱ Restante" : "🚨 Atraso"}: ${min}:${seg.toString().padStart(2, "0")}
        </div>
        <div class="barra-tempo">
          <div class="barra-progresso" style="width:${porcentagem}%"></div>
        </div>
      `;

      if (usuarioEhAdministrador()) card.onclick = () => abrirFinalizarLocacao(b.id);
    } else if (b.status === STATUS.MANUTENCAO) {
      html += `<div class="status-desc" style="color: #f59e0b;"><i class="fa-solid fa-screwdriver-wrench"></i> Em manutenção</div>`;
      if (usuarioEhAdministrador()) card.onclick = () => abrirLiberarManutencao(b.id);
    }

    card.innerHTML = html;

    if (b.status === STATUS.LOCADO || b.status === STATUS.ATRASADO) {
      const btn = document.createElement("button");
      btn.className = "btn-finalizar";
      btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Finalizar';
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        abrirFinalizarLocacao(b.id);
      });
      card.appendChild(btn);
    }

    grid.appendChild(card);
  });
}

// INICIALIZAÇÃO E LOOP DE TEMPO REAL
carregarDadosDoServidor();

// Atualiza contadores e timers a cada 1 segundo
setInterval(() => {
  render();
}, 1000);
