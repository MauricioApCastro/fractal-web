'use strict';

/* ============================================================
 * Lembrete - notificação diária para registrar o progresso das metas.
 *
 * Só existe no app Android: quem agenda e mostra a notificação é o
 * nativo (AlarmManager), que não tem acesso aos projetos. Por isso o
 * JS conta quantas metas estão em andamento e quando houve o último
 * registro, e passa só esses dois números. Nada sai do aparelho.
 * ============================================================ */

const Lembrete = (() => {
  const CHAVE_ULTIMO = 'meta_ultimo_registro';

  function ponte() {
    return typeof window.fractalBridge !== 'undefined'
      && typeof window.fractalBridge.getLembrete === 'function';
  }

  function el(id) { return document.getElementById(id); }

  function estadoNativo() {
    try { return JSON.parse(window.fractalBridge.getLembrete()) || {}; }
    catch (e) { return {}; }
  }

  function doisDigitos(n) { return ('0' + (Number(n) || 0)).slice(-2); }

  function render() {
    const cartao = el('conta-lembrete');
    if (!cartao) return;
    cartao.hidden = !ponte();
    if (!ponte()) return;
    const s = estadoNativo();
    el('lembrete-ativo').checked = !!s.ativo;
    el('lembrete-hora').value = doisDigitos(s.hora != null ? s.hora : 20) + ':' + doisDigitos(s.minuto);
  }

  function configurar() {
    if (!ponte()) return;
    const ativo = el('lembrete-ativo').checked;
    const [h, m] = String(el('lembrete-hora').value || '20:00').split(':');
    try {
      window.fractalBridge.onLembreteConfigurar(ativo ? 'true' : 'false', String(Number(h) || 0), String(Number(m) || 0));
    } catch (e) {
      toast('Não foi possível configurar o lembrete.');
    }
    informar();
  }

  /* O nativo responde aqui depois de pedir a permissão de notificação. */
  window.__fractalLembreteResultado = function (r) {
    if (!r) return;
    if (r.ok) toast(r.ativo ? 'Lembrete diário às ' + r.horario + '.' : 'Lembrete desligado.');
    else toast(r.erro || 'Não foi possível ativar o lembrete.');
    render();
  };

  function metasEmAndamento(miolo) {
    if (!miolo || !Array.isArray(miolo.itens)) return 0;
    return miolo.itens.reduce((total, item) => {
      const meta = item.meta && normalizarMeta(item.meta);
      const ativa = meta && !item.concluido && meta.progresso < meta.dias ? 1 : 0;
      return total + ativa + metasEmAndamento(item.miolo);
    }, 0);
  }

  async function informar() {
    if (!ponte() || typeof window.fractalBridge.onMetasEstado !== 'function') return;
    try {
      const projetos = await Storage.listarProjetos();
      const ativas = projetos.reduce((t, p) => t + metasEmAndamento(p.raiz), 0);
      const ultimo = (await Storage.pegarConfig(CHAVE_ULTIMO)) || '';
      window.fractalBridge.onMetasEstado(String(ativas), String(ultimo));
    } catch (e) { /* o lembrete usa o último estado informado */ }
  }

  /* Chamado quando o usuário registra progresso: o lembrete de hoje some. */
  async function registrouHoje() {
    await Storage.guardarConfig(CHAVE_ULTIMO, dataLocalISO()).catch(() => {});
  }

  const ativo = el('lembrete-ativo');
  const hora = el('lembrete-hora');
  if (ativo) ativo.addEventListener('change', configurar);
  if (hora) hora.addEventListener('change', () => { if (ativo.checked) configurar(); });
  const btnConta = el('btn-conta');
  if (btnConta) btnConta.addEventListener('click', render);
  render();
  setTimeout(informar, 1500);

  return { render, informar, registrouHoje };
})();
