// E-Scooter GO - Funções compartilhadas por todas as telas

// ==========================================
// NAVEGAÇÃO E SEGURANÇA
// ==========================================

function navegarComAnimacao(url) {
  const transicao = document.getElementById("pageTransition");
  if (!transicao) {
    window.location.href = url;
    return;
  }
  transicao.classList.add("show");
  window.setTimeout(() => { window.location.href = url; }, 220);
}

function logout() {
  api.logout();
}

function escaparHtml(valor) {
  return String(valor ?? "").replace(/[&<>'"]/g, caractere => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[caractere]);
}

// ==========================================
// AVISOS NA TELA (TOAST)
// ==========================================

const TIPOS_AVISO = {
  sucesso: { icone: "fa-circle-check", duracao: 3500 },
  erro: { icone: "fa-circle-xmark", duracao: 5500 },
  alerta: { icone: "fa-triangle-exclamation", duracao: 6000 },
  info: { icone: "fa-circle-info", duracao: 4000 }
};

// Descobre o tipo pelo texto quando a tela não informa
function tipoDoAviso(mensagem) {
  const texto = String(mensagem || "").toLowerCase();
  if (texto.includes("com sucesso")) return "sucesso";
  if (/erro|não |nao |inválid|indisponível|falh|recusad|sem permissão|obrigatório|informe|selecione|limite|conclua|finalize|está alugado|muitas tentativas|já está|já existe|já cadastrado/.test(texto)) return "erro";
  if (/⚠️|atrasad|aguardando|novo cadastro|nova manutenção|novas manutenções/.test(texto)) return "alerta";
  if (/iniciad|devolvid|removid|cadastrad|atualizad|liberad|transferid|enviad|concluíd|adicionad|bloquead|desbloquead|salv/.test(texto)) return "sucesso";
  return "info";
}

function exibirAviso(idElemento, mensagem, tipo) {
  const aviso = document.getElementById(idElemento);
  if (!aviso) return;
  const tipoFinal = TIPOS_AVISO[tipo] ? tipo : tipoDoAviso(mensagem);
  const { icone, duracao } = TIPOS_AVISO[tipoFinal];
  const texto = String(mensagem || "").replace(/^⚠️\s*/, "");

  aviso.className = `toast toast-${tipoFinal}`;
  aviso.setAttribute("role", tipoFinal === "erro" ? "alert" : "status");
  aviso.innerHTML = `
    <i class="fa-solid ${icone} toast-icone"></i>
    <span class="toast-texto">${escaparHtml(texto)}</span>
    <span class="toast-barra" style="animation-duration:${duracao}ms"></span>`;
  aviso.onclick = () => aviso.classList.remove("show");

  void aviso.offsetWidth; // reinicia a animação se outro aviso já estava na tela
  aviso.classList.add("show");
  clearTimeout(aviso._temporizador);
  aviso._temporizador = setTimeout(() => aviso.classList.remove("show"), duracao);
}

// ==========================================
// DATAS NO HORÁRIO LOCAL
// ==========================================

// As datas chegam em UTC; relatórios agrupam pelo dia/mês local
function diaLocalISO(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);
  if (!valor || !Number.isFinite(data.getTime())) return "";
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

// Valor para campos <input type="datetime-local">
function dataHoraLocalInput(valor) {
  const data = new Date(valor);
  if (!Number.isFinite(data.getTime())) return "";
  const dois = n => String(n).padStart(2, "0");
  return `${diaLocalISO(data)}T${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

function mesLocalISO(valor) {
  return diaLocalISO(valor).slice(0, 7);
}

// ==========================================
// ATUALIZAÇÃO AUTOMÁTICA
// ==========================================

// Repete "atualizar" a cada intervaloMs; pausa com a aba escondida e quando podeAtualizar() é falso
function iniciarAtualizacaoAutomatica(atualizar, { intervaloMs = 15000, podeAtualizar = () => true } = {}) {
  let emAndamento = false;
  const executar = async () => {
    if (document.hidden || emAndamento || !podeAtualizar()) return;
    emAndamento = true;
    try {
      await atualizar();
    } catch (error) {
      console.warn("Falha na atualização automática:", error);
    } finally {
      emAndamento = false;
    }
  };
  const temporizador = setInterval(executar, intervaloMs);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) executar();
  });
  return { executar, parar: () => clearInterval(temporizador) };
}

// true se o usuário está usando um campo dentro dos seletores informados
function campoEmUsoDentroDe(seletores) {
  const ativo = document.activeElement;
  return Boolean(ativo && ["SELECT", "INPUT", "TEXTAREA"].includes(ativo.tagName) && ativo.closest(seletores));
}

// ==========================================
// PERMISSÕES
// ==========================================

function usuarioEhAdministrador() {
  try {
    const usuario = JSON.parse(localStorage.getItem("usuarioLogado") || "null");
    return usuario && (usuario.usuario === "admin" || usuario.nivel === "administrador");
  } catch {
    return false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (usuarioEhAdministrador()) return;
  document.querySelectorAll("[data-admin-only]").forEach(elemento => elemento.remove());
  document.querySelectorAll(".bottom-nav .nav-item").forEach(item => {
    const destino = item.getAttribute("onclick") || "";
    if (!destino.includes("patinete.html")) item.remove();
  });
  document.querySelectorAll(".bottom-nav").forEach(menu => menu.classList.add("nav-operador"));
});
