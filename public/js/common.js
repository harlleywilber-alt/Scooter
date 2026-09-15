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
