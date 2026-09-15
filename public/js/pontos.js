// Gestão dos pontos de distribuição

let pontos = [];

function mostrarToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.innerText = msg;
  toast.classList.add("show");

  clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

// Carregar pontos da API
async function carregarPontos() {
  try {
    pontos = await api.getPontos();
    renderizarPontos();
  } catch (error) {
    console.error("Erro ao carregar pontos:", error);
    mostrarToast("Erro ao carregar pontos do servidor");
  }
}

function renderizarPontos() {
  const lista = document.getElementById("listaPontos");
  if (!lista) return;

  lista.innerHTML = "";

  if (pontos.length === 0) {
    lista.innerHTML = `
      <div style="text-align: center; color: var(--muted); padding: 40px; background: var(--card-bg); border-radius: var(--radius); border: 1px solid var(--line);">
        <i class="fa-solid fa-location-dot" style="font-size: 32px; margin-bottom: 12px; display: block;"></i>
        Nenhum ponto de distribuição cadastrado. Clique no botão acima para adicionar.
      </div>
    `;
    return;
  }

  pontos.forEach(ponto => {
    const card = document.createElement("div");
    card.className = "card-ponto";

    card.innerHTML = `
      <div class="card-ponto-header">
        <div class="card-ponto-info">
          <h3>${ponto.nome}</h3>
          <div class="card-ponto-local">
            <i class="fa-solid fa-location-dot" style="color: #60a5fa;"></i>
            <span>${ponto.localizacao || "Sem localização"}</span>
          </div>
        </div>
        <button class="btn-deletar-ponto" onclick="confirmarExcluirPonto(${ponto.id}, '${ponto.nome}')" title="Excluir Ponto">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>

      <div class="ponto-metricas-grid">
        <div class="metrica-item">
          <span>Total</span>
          <strong>${ponto.total || 0}</strong>
        </div>

        <div class="metrica-item livres">
          <span>Livres</span>
          <strong>${ponto.livres || 0}</strong>
        </div>

        <div class="metrica-item alugados">
          <span>Alugados</span>
          <strong>${ponto.alugados || 0}</strong>
        </div>
      </div>
    `;

    lista.appendChild(card);
  });
}

// MODAL NOVO PONTO
function abrirModalNovoPonto() {
  document.getElementById("nomePontoInput").value = "";
  document.getElementById("localizacaoPontoInput").value = "";
  document.getElementById("modalPonto").style.display = "flex";
}

function fecharModalPonto() {
  document.getElementById("modalPonto").style.display = "none";
}

window.onclick = function (e) {
  const modal = document.getElementById("modalPonto");
  if (e.target === modal) fecharModalPonto();
};

async function confirmarNovoPonto() {
  const nome = document.getElementById("nomePontoInput").value.trim();
  const localizacao = document.getElementById("localizacaoPontoInput").value.trim();

  if (!nome || nome.length < 2) {
    mostrarToast("Informe o nome do ponto de distribuição");
    return;
  }

  try {
    const res = await api.adicionarPonto(nome, localizacao);
    fecharModalPonto();
    mostrarToast(res.mensagem || "Ponto cadastrado com sucesso!");
    await carregarPontos();
  } catch (error) {
    mostrarToast(error.message);
  }
}

async function confirmarExcluirPonto(id, nome) {
  if (!confirm(`Deseja realmente remover o ponto de distribuição '${nome}'?`)) {
    return;
  }

  try {
    const res = await api.removerPonto(id);
    mostrarToast(res.mensagem || "Ponto removido com sucesso!");
    await carregarPontos();
  } catch (error) {
    mostrarToast(error.message);
  }
}

// INICIALIZAÇÃO E SINCRONIZAÇÃO PERIÓDICA
carregarPontos();
setInterval(carregarPontos, 3000);
