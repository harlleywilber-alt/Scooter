let modoCadastro = false;

/* ================== ERROS ================== */

function mostrarErro(id, msg) {
  const campo = document.getElementById(id);
  if (!campo) return;

  campo.style.outline = "2px solid #ef4444";

  const grupo = campo.closest(".input-group");
  if (!grupo) return;

  const erro = document.createElement("div");
  erro.className = "erro-texto";
  erro.innerText = msg;
  erro.style.color = "#f87171";
  erro.style.fontSize = "13px";
  erro.style.marginTop = "5px";

  grupo.appendChild(erro);
}

function limparErros() {
  document.querySelectorAll(".erro-texto").forEach(e => e.remove());
  document.querySelectorAll("input").forEach(i => (i.style.outline = "none"));
}

/* ================== UI ================== */

function atualizarTelaModo() {
  const grupoNome = document.getElementById("grupoNome");
  const grupoConfirmar = document.getElementById("grupoConfirmarSenha");
  const titulo = document.getElementById("tituloForm");
  const subtitulo = document.getElementById("subtituloForm");
  const btn = document.getElementById("btnAcao");
  const link = document.getElementById("linkTroca");
  const badge = document.getElementById("modoBadge");

  if (modoCadastro) {
    grupoNome.style.display = "block";
    grupoConfirmar.style.display = "block";
    titulo.innerText = "Criar conta";
    subtitulo.innerText = "Cadastre-se no banco de dados do sistema";
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Cadastrar';
    link.innerText = "Já tem conta? Entrar";
    badge.innerText = "Cadastro de Operador";
  } else {
    grupoNome.style.display = "none";
    grupoConfirmar.style.display = "none";
    titulo.innerText = "Entrar";
    subtitulo.innerText = "Acesse sua central de controle";
    btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Entrar';
    link.innerText = "Não tem conta? Cadastre-se";
    badge.innerText = "Painel Administrativo";
  }

  limparErros();
}

function alternarModo() {
  modoCadastro = !modoCadastro;
  atualizarTelaModo();
}

/* ================== VALIDAÇÃO ================== */

function validarCadastro(nome, usuario, senha, confirmar) {
  let ok = true;

  if (!nome || nome.length < 3) {
    mostrarErro("nomeCadastro", "Informe o nome completo (mínimo 3 letras)");
    ok = false;
  }

  if (!usuario || usuario.length < 3) {
    mostrarErro("usuario", "Usuário deve ter pelo menos 3 caracteres");
    ok = false;
  }

  if (!senha || senha.length < 4) {
    mostrarErro("senha", "Senha deve ter pelo menos 4 caracteres");
    ok = false;
  }

  if (senha !== confirmar) {
    mostrarErro("confirmarSenha", "As senhas digitadas não coincidem");
    ok = false;
  }

  return ok;
}

function validarLogin(usuario, senha) {
  let ok = true;

  if (!usuario) {
    mostrarErro("usuario", "Informe o usuário");
    ok = false;
  }

  if (!senha) {
    mostrarErro("senha", "Informe a senha");
    ok = false;
  }

  return ok;
}

/* ================== CADASTRO (API + BANCO) ================== */

async function cadastrarUsuario() {
  limparErros();

  const nome = document.getElementById("nomeCadastro").value.trim();
  const usuario = document.getElementById("usuario").value.trim();
  const senha = document.getElementById("senha").value.trim();
  const confirmar = document.getElementById("confirmarSenha").value.trim();

  if (!validarCadastro(nome, usuario, senha, confirmar)) return;

  const btn = document.getElementById("btnAcao");
  btn.disabled = true;
  btn.innerText = "Cadastrando...";

  try {
    const res = await api.cadastro(nome, usuario, senha);
    alert(res.mensagem || "Conta criada com sucesso com senha criptografada!");
    modoCadastro = false;
    atualizarTelaModo();
    document.getElementById("usuario").value = usuario;
    document.getElementById("senha").value = "";
  } catch (erro) {
    mostrarErro("usuario", erro.message);
  } finally {
    btn.disabled = false;
    atualizarTelaModo();
  }
}

/* ================== LOGIN (API + BANCO) ================== */

async function entrarSistema() {
  limparErros();

  const usuario = document.getElementById("usuario").value.trim();
  const senha = document.getElementById("senha").value.trim();

  if (!validarLogin(usuario, senha)) return;

  const btn = document.getElementById("btnAcao");
  btn.disabled = true;
  btn.innerText = "Autenticando...";

  try {
    await api.login(usuario, senha);
    window.location.href = "patinete.html";
  } catch (erro) {
    mostrarErro("usuario", erro.message);
    mostrarErro("senha", erro.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Entrar';
  }
}

/* ================== BOTÃO PRINCIPAL ================== */

function acaoPrincipal() {
  if (modoCadastro) {
    cadastrarUsuario();
  } else {
    entrarSistema();
  }
}

/* ================== ENTER ================== */

document.addEventListener("keypress", function (e) {
  if (e.key === "Enter") {
    acaoPrincipal();
  }
});

/* ================== INICIALIZAÇÃO ================== */

atualizarTelaModo();