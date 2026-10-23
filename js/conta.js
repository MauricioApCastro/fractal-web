'use strict';

/* ============================================================
 * Conta - tela de login e estado da sincronização.
 *
 * Não bloqueia o app: o Fractal abre normalmente sem login e só
 * sincroniza quando o usuário entra com o Google.
 * ============================================================ */

const Conta = (() => {
  let googleRenderizado = false;

  function $id(id) { return document.getElementById(id); }

  function aviso(msg, erro) {
    const t = $id('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    t.classList.toggle('toast-erro', !!erro);
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; t.classList.remove('toast-erro'); }, erro ? 4200 : 2200);
  }

  function rotuloSituacao(s) {
    switch (s.situacao) {
      case 'sincronizado': return 'Sincronizado';
      case 'pendente': return 'Sincronizando...';
      case 'erro': return 'Erro na sincronização';
      default: return 'Só neste aparelho';
    }
  }

  function formatarData(d) {
    if (!d) return '';
    try {
      return new Date(d).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    } catch (e) { return ''; }
  }

  function render() {
    const s = Sync.status();

    const statusEl = $id('conta-status');
    if (statusEl) {
      statusEl.textContent = rotuloSituacao(s);
      statusEl.dataset.situacao = s.situacao;
    }

    const msgEl = $id('conta-mensagem');
    if (msgEl) {
      const erroAuth = GoogleAuth.estado().erro;
      msgEl.textContent = erroAuth || s.mensagem || '';
      msgEl.classList.toggle('conta-erro', !!erroAuth);
    }

    const ultimaEl = $id('conta-ultima');
    if (ultimaEl) {
      ultimaEl.textContent = s.ultimo ? 'Última sincronização: ' + formatarData(s.ultimo) : '';
    }

    /* Armazenamento do Drive (a cota do usuário). */
    const armEl = $id('conta-armazenamento');
    if (armEl) {
      if (s.cota && s.cota.limite > 0) {
        const pct = Math.round((s.cota.uso / s.cota.limite) * 100);
        armEl.textContent = 'Drive: ' + Sync.formatarBytes(s.cota.uso) + ' de ' +
          Sync.formatarBytes(s.cota.limite) + ' usados (' + pct + '%)';
      } else {
        armEl.textContent = '';
      }
    }

    /* Avisos da última sincronização (cota, anexo que falhou...). */
    const avisosEl = $id('conta-avisos');
    if (avisosEl) {
      avisosEl.innerHTML = '';
      (s.avisos || []).forEach(a => {
        const p = document.createElement('p');
        p.className = 'conta-aviso-item';
        p.textContent = a;
        avisosEl.appendChild(p);
      });
    }

    const emailEl = $id('conta-email');
    if (emailEl) emailEl.textContent = s.email || s.nome || '';

    const logado = !!s.logado;

    const blocoDeslogado = $id('conta-deslogado');
    const blocoLogado = $id('conta-logado');
    if (blocoDeslogado) blocoDeslogado.hidden = logado;
    if (blocoLogado) blocoLogado.hidden = !logado;

    const btnSinc = $id('btn-sincronizar');
    if (btnSinc) btnSinc.disabled = !logado || s.situacao === 'pendente';

    /* Botão oficial do Google (apenas na web). */
    const alvo = $id('conta-google');
    if (alvo && !googleRenderizado) {
      if (GoogleAuth.temWebClient()) {
        try {
          googleRenderizado = true;
          GoogleAuth.entrarWeb(alvo).catch(err => {
            googleRenderizado = false;
            aviso(err.message || 'Falha no login do Google.', true);
          });
        } catch (err) { /* ignora */ }
      } else {
        alvo.innerHTML = '<p class="conta-aviso">Login na web ainda sem credenciais. ' +
          'Preencha <code>js/config.js</code> (veja SYNC-SETUP.md).</p>';
      }
    }

    const btnNativo = $id('btn-entrar-nativo');
    if (btnNativo) btnNativo.hidden = !GoogleAuth.temPonteNativa();

    /* Resumo no rodapé da lista. */
    const resumo = $id('conta-resumo');
    if (resumo) {
      resumo.textContent = logado ? 'Conta: ' + (s.email || 'conectada') : 'Conta: local';
    }
  }

  function abrir() {
    mostrarTela('conta');
    render();
  }

  function fechar() {
    mostrarTela('lista');
    renderizarLista();
  }

  async function entrarNativo() {
    try {
      await GoogleAuth.entrarNativo();
      aviso('Login feito. Sincronizando...');
      await Sync.sincronizar();
      render();
    } catch (err) {
      aviso(err.message || 'Falha no login do Google.', true);
      render();
    }
  }

  async function sair() {
    await Sync.sair();
    googleRenderizado = false;
    aviso('Saiu da conta. Os dados continuam neste aparelho.');
    render();
  }

  async function sincronizarAgora() {
    await Sync.sincronizar(true);
    render();
    const s = Sync.status();
    if (s.situacao === 'erro') aviso(s.mensagem || 'Falha ao sincronizar.', true);
  }

  /* Exclusão total dos dados (LGPD, art. 18): apaga o que está no
     Drive (índice + pasta Fractal) e o que está neste aparelho. */
  async function apagarMeusDados() {
    const ok = window.confirm(
      'Isto apaga TODOS os seus dados do Fractal:\n\n' +
      '• os projetos e anexos deste aparelho;\n' +
      '• a pasta "Fractal" e o índice do app no seu Google Drive;\n' +
      '• a sua sessão do Google neste aparelho.\n\n' +
      'Não dá para desfazer. Quer continuar?'
    );
    if (!ok) return;

    const btn = $id('btn-apagar-dados');
    if (btn) { btn.disabled = true; btn.textContent = 'Apagando...'; }
    try {
      await Sync.apagarTudo();
      aviso('Todos os seus dados foram apagados.');
      renderizarLista();
    } catch (err) {
      aviso(err.message || 'Falha ao apagar os dados.', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Apagar meus dados'; }
      render();
    }
  }

  function wire() {
    const btnConta = $id('btn-conta');
    if (btnConta) btnConta.addEventListener('click', abrir);

    const btnVoltar = $id('conta-voltar');
    if (btnVoltar) btnVoltar.addEventListener('click', fechar);

    const btnNativo = $id('btn-entrar-nativo');
    if (btnNativo) btnNativo.addEventListener('click', entrarNativo);

    const btnSair = $id('btn-sair');
    if (btnSair) btnSair.addEventListener('click', sair);

    const btnSinc = $id('btn-sincronizar');
    if (btnSinc) btnSinc.addEventListener('click', sincronizarAgora);

    const btnApagar = $id('btn-apagar-dados');
    if (btnApagar) btnApagar.addEventListener('click', apagarMeusDados);

    Sync.onChange(render);
    GoogleAuth.onChange(render);
  }

  async function iniciar() {
    wire();
    /* Avisa o app nativo que a pagina carregou: se o app foi aberto
       pelo redirect do Google, e agora que a resposta pode chegar. */
    try {
      if (window.fractalBridge && typeof window.fractalBridge.onWebViewPronto === 'function') {
        window.fractalBridge.onWebViewPronto();
      }
    } catch (e) { /* sem ponte nativa (web) */ }
    await Sync.iniciar();
    render();
  }

  return { iniciar, render, abrir, fechar };
})();

document.addEventListener('DOMContentLoaded', () => {
  Conta.iniciar().catch(err => {
    console.warn('Conta:', err);
  });
});
