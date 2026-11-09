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

  /* Compromissos em aberto, com o próximo aviso de cada um. O nativo só
     recebe nome, horário e texto do aviso; o resto do projeto fica aqui. */
  function compromissosPendentes(projetos) {
    const lista = [];
    const agora = Date.now();
    const andar = miolo => (miolo && miolo.itens || []).forEach(item => {
      const c = normalizarCompromisso(item.compromisso);
      if (c && !item.concluido) {
        const [h, m] = c.hora.split(':').map(Number);
        let alvo;
        if (c.repetir === 'diario') {
          alvo = new Date(); alvo.setHours(h, m, 0, 0);
          if (alvo.getTime() - c.antes * 60000 <= agora) alvo.setDate(alvo.getDate() + 1);
        } else if (c.repetir === 'mensal') {
          alvo = vencimentoPendente(c);
          // O aviso deste vencimento já passou: vale o do mês seguinte.
          if (alvo.getTime() - c.antes * 60000 <= agora) {
            alvo = vencimentoPendente(c, new Date(alvo.getFullYear(), alvo.getMonth() + 1, 1));
          }
        } else {
          alvo = new Date(c.data + 'T' + c.hora + ':00');
        }
        const quando = alvo.getTime() - c.antes * 60000;
        if (quando > agora) {
          const ddmm = String(alvo.getDate()).padStart(2, '0') + '/' + String(alvo.getMonth() + 1).padStart(2, '0');
          const hoje = mesDe(alvo) === mesDe(new Date()) && alvo.getDate() === new Date().getDate();
          const quandoTexto = c.repetir === 'diario' ? 'Hoje às ' + c.hora
            : c.repetir === 'mensal' ? (hoje ? 'Conta vence hoje' : 'Conta vence dia ' + ddmm)
              : (hoje ? 'Hoje às ' + c.hora : 'Dia ' + ddmm + ' às ' + c.hora);
          lista.push({
            titulo: item.nome || 'Compromisso',
            texto: quandoTexto + (c.antes ? ' (lembrete ' + (ROTULOS_ANTES[c.antes] || '').toLowerCase() + ')' : ''),
            quando,
            diario: c.repetir === 'diario',
            mensal: c.repetir === 'mensal',
            dia: Number(c.data.slice(8, 10)) || 0,
            hora: c.hora,
            antes: c.antes,
          });
        }
      }
      andar(item.miolo);
    });
    projetos.forEach(p => andar(p.raiz));
    return lista.sort((a, b) => a.quando - b.quando).slice(0, 60);
  }

  async function informar(pedirPermissao) {
    if (!ponte()) return;
    try {
      const projetos = await Storage.listarProjetos();
      if (typeof window.fractalBridge.onMetasEstado === 'function') {
        const ativas = projetos.reduce((t, p) => t + metasEmAndamento(p.raiz), 0);
        const ultimo = (await Storage.pegarConfig(CHAVE_ULTIMO)) || '';
        window.fractalBridge.onMetasEstado(String(ativas), String(ultimo));
      }
      if (typeof window.fractalBridge.onCompromissos === 'function') {
        window.fractalBridge.onCompromissos(JSON.stringify(compromissosPendentes(projetos)),
          pedirPermissao ? 'true' : 'false');
      }
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
