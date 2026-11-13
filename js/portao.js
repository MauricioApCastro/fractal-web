'use strict';

/* ============================================================
 * Portão da versão web no mactecnology.com.br.
 *
 * Lá o Fractal só abre para quem já usa o app Android: a pessoa
 * entra com a conta Google e o portão procura, no Drive dela, o
 * fractal.json com a marca "android" (o app grava essa marca na
 * primeira sincronização; ver sync.js).
 *
 * Não é segurança (o site é estático e o código é público): é o
 * que faz da versão web um complemento do app. O script do <head>
 * do index.html fecha o portão antes do primeiro desenho; aqui ele
 * é aberto. No app Android e no endereço antigo nada disso roda.
 *
 * Depois de liberada, a conta fica lembrada neste navegador, para
 * o app abrir mesmo sem internet.
 * ============================================================ */

const Portao = (() => {
  const CHAVE = 'portao_liberado';
  const html = document.documentElement;
  let verificando = false;
  let botaoGoogle = false;

  function $id(id) { return document.getElementById(id); }
  function site() { return (typeof FractalConfig !== 'undefined' && FractalConfig.site) || {}; }
  function fechado() { return html.dataset.portao === 'fechado'; }

  function mostrar(etapa, texto, erro) {
    ['entrar', 'verificando', 'negado'].forEach(n => {
      const el = $id('portao-' + n);
      if (el) el.hidden = n !== etapa;
    });
    const msg = $id('portao-mensagem');
    if (msg) {
      msg.textContent = texto || '';
      msg.classList.toggle('conta-erro', !!erro);
    }
  }

  function abrir() {
    html.dataset.portao = 'aberto';
    /* Agora sim traz os projetos do Drive. */
    if (typeof Sync !== 'undefined') Sync.sincronizar().catch(() => {});
  }

  function emailAtual() {
    return String(GoogleAuth.estado().email || '').toLowerCase();
  }

  async function liberadaAntes(email) {
    if (!email) return false;
    try { return (await Storage.pegarConfig(CHAVE)) === email; } catch (e) { return false; }
  }

  async function verificar() {
    if (!fechado() || verificando) return;
    if (!GoogleAuth.logado()) { mostrarEntrar(); return; }

    const email = emailAtual();
    if (await liberadaAntes(email)) { abrir(); return; }

    verificando = true;
    mostrar('verificando', 'Procurando o Fractal do Android na conta ' + email + '...');
    try {
      const arq = await DriveSync.encontrar();
      const doc = arq ? await DriveSync.baixar(arq.id) : null;
      if (doc && doc.android) {
        await Storage.guardarConfig(CHAVE, email).catch(() => {});
        abrir();
      } else {
        mostrar('negado', doc
          ? 'A conta ' + email + ' tem projetos do Fractal, mas ainda não sincronizou pelo app Android. ' +
            'Atualize o app, entre com esta conta e toque em "Sincronizar agora".'
          : 'A conta ' + email + ' ainda não usou o Fractal no Android.');
      }
    } catch (err) {
      mostrar('negado', 'Não foi possível conferir a conta: ' + ((err && err.message) || err), true);
    } finally {
      verificando = false;
    }
  }

  function mostrarEntrar() {
    mostrar('entrar', '');
    if (botaoGoogle) return;
    const alvo = $id('portao-google');
    if (!alvo) return;
    if (!GoogleAuth.temWebClient()) {
      alvo.innerHTML = '<p class="conta-aviso">O login com Google não está disponível neste navegador.</p>';
      return;
    }
    botaoGoogle = true;
    GoogleAuth.entrarWeb(alvo).catch(err => {
      botaoGoogle = false;
      mostrar('entrar', (err && err.message) || 'Falha no login do Google.', true);
    });
  }

  async function outraConta() {
    await Storage.apagarConfig(CHAVE).catch(() => {});
    if (typeof Sync !== 'undefined') await Sync.sair().catch(() => {});
    else await GoogleAuth.sair().catch(() => {});
    botaoGoogle = false;
    mostrarEntrar();
  }

  /* Endereço antigo: continua funcionando, com um aviso do novo. */
  function avisoAntigo() {
    const s = site();
    const aviso = $id('aviso-endereco');
    if (!aviso || !s.antigo || location.hostname !== s.antigo || GoogleAuth.temPonteNativa()) return;
    const link = aviso.querySelector('a');
    if (link) { link.href = s.web; link.textContent = s.web.replace(/^https:\/\//, '').replace(/\/$/, ''); }
    aviso.hidden = false;
    const fechar = $id('aviso-endereco-fechar');
    if (fechar) fechar.addEventListener('click', () => { aviso.hidden = true; });
  }

  /* No app Android: cartão "Usar no computador" com o endereço do site. */
  function cartaoAndroid() {
    const s = site();
    const cartao = $id('conta-computador');
    if (!cartao || !s.web || !GoogleAuth.temPonteNativa()) return;
    const link = $id('conta-computador-link');
    if (link) { link.href = s.web; link.textContent = s.web.replace(/^https:\/\//, '').replace(/\/$/, ''); }
    cartao.hidden = false;
  }

  function iniciar() {
    avisoAntigo();
    cartaoAndroid();
    if (!fechado()) return;
    const play = $id('portao-play');
    if (play && site().play) play.href = site().play;
    const outra = $id('portao-outra');
    if (outra) outra.addEventListener('click', outraConta);
    GoogleAuth.onChange(() => { verificar(); });
    /* Conta.iniciar() restaura a sessão; espera um pouco por ela. */
    setTimeout(verificar, 300);
  }

  return { iniciar, verificar };
})();

document.addEventListener('DOMContentLoaded', () => {
  try { Portao.iniciar(); } catch (e) { console.warn('Portão:', e); }
});
