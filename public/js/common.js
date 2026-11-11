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

// Dia/mês no horário local do navegador. As datas vêm em UTC (ISO), então
// "slice(0, 7)" colocava locações feitas após 21h do último dia no mês seguinte.
function diaLocalISO(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);
  if (!valor || !Number.isFinite(data.getTime())) return "";
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

// Valor para <input type="datetime-local"> no horário local (toISOString() mostrava UTC, 3h adiantado)
function dataHoraLocalInput(valor) {
  const data = new Date(valor);
  if (!Number.isFinite(data.getTime())) return "";
  const dois = n => String(n).padStart(2, "0");
  return `${diaLocalISO(data)}T${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

function mesLocalISO(valor) {
  return diaLocalISO(valor).slice(0, 7);
}

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
