(function protegerPagina() {
  const exigencia = document.documentElement.dataset.access;
  if (!exigencia) return;

  const autenticado = localStorage.getItem("logado") === "true" && Boolean(localStorage.getItem("authToken"));
  if (!autenticado) {
    window.location.replace("login.html");
    return;
  }

  if (exigencia === "admin") {
    let usuario = null;
    try {
      usuario = JSON.parse(localStorage.getItem("usuarioLogado") || "null");
    } catch {
      usuario = null;
    }

    const administrador = usuario && (usuario.usuario === "admin" || usuario.nivel === "administrador");
    if (!administrador) {
      window.location.replace("patinete.html");
      return;
    }
  }

  document.documentElement.classList.add("acesso-liberado");
})();
