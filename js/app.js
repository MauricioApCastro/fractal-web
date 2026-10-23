'use strict';
document.documentElement.dataset.loadedjs = '1';

/* ============================================================
 * Fractal - lógica da interface
 * ============================================================ */

const $ = sel => document.querySelector(sel);

/* Versão visível no rodapé (bump a cada release p/ identificar o build). */
const VERSAO_APP = '25';

const Estado = {
  projetos: [],
  atual: null,        // projeto em uso
  caminho: [],        // pilha de miolos (raiz primeiro)
  itemPai: null,      // item que originou o miolo atual
  anexosDe: null,     // miolo cujos anexos estão abertos
  anexosTitulo: '',
  tela: 'lista',
  larguraCanvas: 208,
  alturaCanvas: 208,
  quantidadeItens: null,
  zoomUsuario: 1,
  escalaAplicada: 1,
  escalaTelaAplicada: 1,
  limiteEscalaTela: null,
  panX: 0,
  panY: 0,
  arrastouFlor: false,
  observadorTamanho: null,
};

function mioloAtual() {
  return Estado.caminho[Estado.caminho.length - 1];
}

async function guardar() {
  if (!Estado.atual) return;
  Estado.atual.modificado = new Date().toISOString();
  await Storage.salvarProjeto(Estado.atual);
  sincronizarProjetoNaLista();
  // Se houver conta do Google conectada, agenda o envio para o Drive.
  if (typeof Sync !== 'undefined' && Sync && Sync.marcarSujo) Sync.marcarSujo();
}

/* O projeto em edicao e outra instancia da que esta no cache da lista.
 * Guardar o mesmo objeto aqui mantem nome, contagem de itens, anexos e a
 * data relativa em dia quando o usuario volta para o menu de projetos. */
function sincronizarProjetoNaLista() {
  const projeto = Estado.atual;
  if (!projeto || !projeto.id || !Array.isArray(Estado.projetos)) return;
  const i = Estado.projetos.findIndex(p => p.id === projeto.id);
  if (i >= 0) Estado.projetos[i] = projeto;
  else Estado.projetos.push(projeto);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ============================================================
 * Som de toque nos fractais (Web Audio - sem arquivos)
 * ============================================================ */

const Som = (() => {
  let ctx = null;
  const ativo = () => localStorage.getItem('fractal_som') !== 'off';

  function contexto() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function nota(freq, dur, ganho, atraso) {
    const c = contexto();
    if (!c) return;
    const t = c.currentTime + (atraso || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(ganho, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    ligado: ativo,
    alternar() {
      const novo = localStorage.getItem('fractal_som') === 'off' ? 'on' : 'off';
      localStorage.setItem('fractal_som', novo);
      return novo !== 'off';
    },
    item() { if (!ativo()) return; nota(440, 0.09, 0.16); nota(880, 0.06, 0.05, 0.02); },
    centro() { if (!ativo()) return; nota(523.25, 0.1, 0.16); nota(783.99, 0.08, 0.06, 0.03); },
  };
})();

/* ============================================================
 * Diagnóstico em tela: mostra NÃO-inicializações/erros de JS
 * ============================================================ */

function mostrarErroTela(msg) {
  const el = $('#erro-tela');
  if (!el) return;
  el.textContent = 'Erro no app: ' + msg;
  el.hidden = false;
  console.error('[Fractal]', msg);
}

window.addEventListener('error', e => {
  mostrarErroTela(String(e.message || 'erro desconhecido') +
    (e.filename ? ' em ' + String(e.filename).split('/').pop() + ':' + e.lineno : ''));
});
window.addEventListener('unhandledrejection', e => {
  const r = e && e.reason;
  mostrarErroTela('Promise: ' + ((r && r.message) || r || 'rejeição sem detalhe'));
});

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ============================================================
 * Navegação entre telas
 * ============================================================ */

function mostrarTela(nome) {
  Estado.tela = nome;
  document.querySelectorAll('.tela').forEach(s => {
    s.classList.toggle('ativa', s.id === 'tela-' + nome);
  });
}

function irParaLista() {
  Estado.atual = null;
  Estado.caminho = [];
  Estado.itemPai = null;
  Estado.anexosDe = null;
  mostrarTela('lista');
  renderizarLista();
}

function resetarZoomFlor() {
  Estado.quantidadeItens = null;
  Estado.zoomUsuario = 1;
  Estado.escalaAplicada = 0;
  Estado.escalaTelaAplicada = 1;
  Estado.limiteEscalaTela = null;
  Estado.panX = 0;
  Estado.panY = 0;
}

function irParaFlor(projeto) {
  Estado.atual = projeto;
  Estado.caminho = [projeto.raiz];
  Estado.itemPai = null;
  resetarZoomFlor();
  mostrarTela('flor');
  renderizarFlor();
}

function entrarItem(item) {
  if (!item.miolo) item.miolo = novoMiolo(item.nome);
  Estado.caminho.push(item.miolo);
  Estado.itemPai = item;
  resetarZoomFlor();
  renderizarFlor();
}

function voltar() {
  if (Estado.caminho.length > 1) {
    Estado.caminho.pop();
    Estado.itemPai = null;
    resetarZoomFlor();
    renderizarFlor();
    return;
  }
  irParaLista();
}

/* ============================================================
 * Voltar unificado (teclado e botão do celular)
 * Devolve true quando o app tratou o comando.
 * Devolve false na lista de projetos, para o app poder fechar.
 * ============================================================ */
function tratarVoltar() {
  if (!$('#sheet-overlay').hidden) { fecharSheet(); return true; }
  if (!$('#modal-overlay').hidden) { resolverModal(null); return true; }
  if (Estado.tela === 'conta') {
    mostrarTela('lista');
    renderizarLista();
    return true;
  }
  if (Estado.tela === 'anexos') {
    mostrarTela('flor');
    renderizarFlor();
    return true;
  }
  if (Estado.tela === 'flor') { voltar(); return true; }
  return false;
}

// Usado pelo MainActivity no Android para o botão voltar do aparelho.
window.__fractalVoltar = tratarVoltar;

/* ============================================================
 * LISTA DE PROJETOS
 * ============================================================ */

function dataAmigavel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const agora = new Date();
  const diff = agora - d;
  if (diff < 60000) return 'agora mesmo';
  if (diff < 3600000) return 'há ' + Math.round(diff / 60000) + ' min';
  if (diff < 86400000) return 'há ' + Math.round(diff / 3600000) + 'h';
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  if (dia.getTime() === hoje.getTime()) return 'hoje';
  if (dia.getTime() === ontem.getTime()) return 'ontem';
  return d.toLocaleDateString('pt-BR');
}

function renderizarLista() {
  const container = $('#lista-container');
  const vazio = $('#lista-vazia');
  container.innerHTML = '';

  const projetos = [...Estado.projetos].sort((a, b) => (b.modificado || '').localeCompare(a.modificado || ''));

  container.appendChild(vazio);
  vazio.style.display = projetos.length === 0 ? '' : 'none';

  projetos.forEach(proj => {
    const t = totalItens(proj.raiz);
    const a = totalAnexos(proj.raiz);

    const el = document.createElement('div');
    el.className = 'item-projeto';

    const balao = document.createElement('div');
    balao.className = 'balao-projeto';
    balao.textContent = (proj.nome || '?').trim().charAt(0).toUpperCase() || '?';

    const dados = document.createElement('div');
    dados.className = 'dados-projeto';
    const nome = document.createElement('div');
    nome.className = 'nome';
    nome.textContent = proj.nome || 'Sem nome';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent =
      (t === 1 ? '1 item' : t + ' itens') +
      (a > 0 ? ' • ' + a + ' anexo(s)' : '') +
      (proj.modificado ? ' • ' + dataAmigavel(proj.modificado) : '');
    dados.appendChild(nome);
    dados.appendChild(meta);

    const apagar = document.createElement('button');
    apagar.className = 'botao-apagar';
    apagar.title = 'Apagar projeto';
    apagar.setAttribute('aria-label', 'Apagar projeto');
    apagar.textContent = '\u00D7';
    apagar.addEventListener('click', e => {
      e.stopPropagation();
      confirmar('Apagar projeto', 'Apagar permanentemente "' + (proj.nome || '') + '"?', async () => {
        await Storage.apagarProjeto(proj.id);
        await recarregarProjetos();
        toast('Projeto apagado.');
      });
    });

    el.addEventListener('click', () => {
      Storage.carregarProjeto(proj.id).then(carregado => {
        if (!carregado) { toast('Projeto não encontrado.'); recarregarProjetos(); return; }
        irParaFlor(carregado);
      });
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      confirmar('Apagar projeto', 'Apagar permanentemente "' + (proj.nome || '') + '"?', async () => {
        await Storage.apagarProjeto(proj.id);
        await recarregarProjetos();
        toast('Projeto apagado.');
      });
    });

    el.appendChild(balao);
    el.appendChild(dados);
    el.appendChild(apagar);
    container.appendChild(el);
  });
}

async function recarregarProjetos() {
  Estado.projetos = await Storage.listarProjetos();
  renderizarLista();
}

/* ============================================================
 * FLOR (FRACTAL)
 * ============================================================ */

const TAM_ITEM = 118;
const TAM_CENTRO = 160;

function dataLocalISO(data = new Date()) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return ano + '-' + mes + '-' + dia;
}

function somarDias(dataISO, dias) {
  const data = new Date(dataISO + 'T12:00:00');
  data.setDate(data.getDate() + dias);
  return dataLocalISO(data);
}

function normalizarMeta(meta) {
  if (!meta) return null;
  const dias = Math.max(1, Math.min(3650, Math.floor(Number(meta.dias) || 30)));
  const progresso = Math.max(0, Math.min(dias, Math.floor(Number(meta.progresso) || 0)));
  const inicioBruto = meta.inicio || dataLocalISO();
  const dataInicio = /^\d{4}-\d{2}-\d{2}$/.test(inicioBruto)
    ? new Date(inicioBruto + 'T12:00:00')
    : new Date(inicioBruto);
  const inicio = isNaN(dataInicio.getTime()) ? dataLocalISO() : dataLocalISO(dataInicio);
  const prazoBruto = meta.prazo || '';
  const dataPrazo = prazoBruto
    ? (/^\d{4}-\d{2}-\d{2}$/.test(prazoBruto) ? new Date(prazoBruto + 'T12:00:00') : new Date(prazoBruto))
    : null;
  const prazo = dataPrazo && !isNaN(dataPrazo.getTime()) ? dataLocalISO(dataPrazo) : somarDias(inicio, dias);
  const prazoManualBruto = meta.prazoManual || '';
  const dataPrazoManual = /^\d{4}-\d{2}-\d{2}$/.test(prazoManualBruto)
    ? new Date(prazoManualBruto + 'T12:00:00')
    : null;
  const prazoManual = dataPrazoManual && !isNaN(dataPrazoManual.getTime()) ? dataLocalISO(dataPrazoManual) : '';
  return {
    dias,
    progresso,
    inicio,
    prazo,
    prazoManual,
  };
}

function criarMeta(dias, inicio) {
  return normalizarMeta({ dias, progresso: 0, inicio });
}

function formatarDataMeta(dataISO) {
  if (!dataISO) return '';
  const data = new Date(dataISO + 'T12:00:00');
  if (isNaN(data.getTime())) return '';
  return data.toLocaleDateString('pt-BR');
}

function diasAtePrazo(prazoISO) {
  if (!prazoISO || !/^\d{4}-\d{2}-\d{2}$/.test(prazoISO)) return null;
  const hoje = new Date(dataLocalISO() + 'T12:00:00');
  const prazo = new Date(prazoISO + 'T12:00:00');
  return Math.round((prazo - hoje) / 86400000);
}

function infoPrazoMeta(meta) {
  if (!meta) return '';
  const prazoRef = meta.prazoManual || meta.prazo;
  const dias = diasAtePrazo(prazoRef);
  if (dias === null) return 'Prazo: ' + formatarDataMeta(prazoRef);
  const concluida = meta.progresso >= meta.dias;
  if (concluida) return 'Prazo: ' + formatarDataMeta(prazoRef);
  if (dias < 0) return 'Atraso: ' + Math.abs(dias) + (Math.abs(dias) === 1 ? ' dia' : ' dias');
  if (dias === 0) return 'Prazo: hoje';
  return 'Restam ' + dias + (dias === 1 ? ' dia' : ' dias');
}

function itemConcluido(item) {
  const meta = normalizarMeta(item.meta);
  return item.concluido === true || (meta && meta.progresso >= meta.dias);
}

function progressoAgregado(item) {
  if (!item || !item.miolo) return null;
  let totalDias = 0;
  let totalProgresso = 0;
  const miolo = item.miolo;
  for (const sub of miolo.itens) {
    const m = normalizarMeta(sub.meta);
    if (m) {
      totalDias += m.dias;
      totalProgresso += m.progresso;
    }
    if (sub.miolo) {
      const subAgregado = progressoAgregado(sub);
      if (subAgregado) {
        totalDias += subAgregado.dias;
        totalProgresso += subAgregado.progresso;
      }
    }
  }
  if (totalDias === 0) return null;
  return { dias: totalDias, progresso: totalProgresso };
}

/* Marca/desmarca guardando a data de conclusão (concluidoEm, yyyy-mm-dd).
   Reabrir limpa a data; concluir de novo registra a nova data. */
function marcarConcluido(item, sim) {
  const era = item.concluido === true;
  item.concluido = sim === true;
  if (item.concluido && !era) item.concluidoEm = dataLocalISO();
  if (!item.concluido && era) item.concluidoEm = null;
}

function textoConclusao(item) {
  let dataFmt = '';
  try {
    const d = new Date((item.concluidoEm || '') + 'T12:00:00');
    if (!isNaN(d.getTime())) dataFmt = ' ' + d.toLocaleDateString('pt-BR');
  } catch (e) { /* sem data: mostra só "concluído" */ }
  return 'concluído' + dataFmt;
}

function renderizarFlor() {
  const miolo = mioloAtual();
  if (!miolo) return;
  const metaAtiva = Estado.itemPai && miolo === Estado.itemPai.miolo
    ? normalizarMeta(Estado.itemPai.meta)
    : null;
  renderizarControleMeta(metaAtiva);

  /* breadcrumb */
  const crumb = $('#caminho');
  crumb.innerHTML = '';
  Estado.caminho.forEach((m, i) => {
    if (i > 0) {
      const s = document.createElement('span');
      s.textContent = ' \u203A ';
      crumb.appendChild(s);
    }
    const b = document.createElement('b');
    b.textContent = m.nome || 'Sem nome';
    crumb.appendChild(b);
  });

  const area = $('#flor-area');
  area.innerHTML = '';

  const n = miolo.itens.length;
  const nConcluidos = miolo.itens.reduce((total, item) => total + (itemConcluido(item) ? 1 : 0), 0);
  const quantidadeAnterior = Estado.quantidadeItens;
  const escalaTelaAnterior = Estado.escalaTelaAplicada;
  if (quantidadeAnterior !== n) {
    resetarZoomFlor();
    Estado.limiteEscalaTela = quantidadeAnterior !== null && n > quantidadeAnterior
      ? escalaTelaAnterior * 0.995
      : null;
    Estado.quantidadeItens = n;
  }

  const margem = 24;
  const raioCentro = TAM_CENTRO / 2;
  const raioItem = TAM_ITEM / 2;
  const raio = n > 0 ? 172 + (n - 1) * 19 : 0;
  const posicoes = miolo.itens.map((item, i) => {
    const ang = (n === 1 ? -90 : -90 + i * 360 / n) * Math.PI / 180;
    return { item, dx: raio * Math.cos(ang), dy: raio * Math.sin(ang) };
  });

  let minX = -raioCentro;
  let maxX = raioCentro;
  let minY = -raioCentro;
  let maxY = raioCentro;
  posicoes.forEach(p => {
    minX = Math.min(minX, p.dx - raioItem);
    maxX = Math.max(maxX, p.dx + raioItem);
    minY = Math.min(minY, p.dy - raioItem);
    maxY = Math.max(maxY, p.dy + raioItem);
  });

  const medidaMinima = TAM_CENTRO + margem * 2 + Math.max(0, n - 1) * 8;
  const largura = Math.max(medidaMinima, Math.ceil(maxX - minX + margem * 2));
  const altura = Math.max(medidaMinima, Math.ceil(maxY - minY + margem * 2));
  const cx = largura / 2 - (minX + maxX) / 2;
  const cy = altura / 2 - (minY + maxY) / 2;
  Estado.larguraCanvas = largura;
  Estado.alturaCanvas = altura;

  area.style.width = largura + 'px';
  area.style.height = altura + 'px';

  /* conexões entre o centro e os itens */
  const conexoes = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  conexoes.setAttribute('class', 'conexoes-fractal');
  conexoes.setAttribute('viewBox', '0 0 ' + largura + ' ' + altura);
  conexoes.setAttribute('aria-hidden', 'true');
  conexoes.setAttribute('focusable', 'false');
  area.appendChild(conexoes);

  /* centro */
  const centro = document.createElement('div');
  centro.className = metaAtiva ? 'centro meta-centro' : 'centro';
  if ((!metaAtiva && n > 0 && nConcluidos === n) ||
      (metaAtiva && metaAtiva.progresso >= metaAtiva.dias)) {
    centro.classList.add('projeto-concluido');
  }
  centro.style.background = metaAtiva ? 'transparent' : 'linear-gradient(135deg, ' + COR_MIOLO[0] + ', ' + COR_MIOLO[1] + ')';
  centro.style.left = (cx - TAM_CENTRO / 2) + 'px';
  centro.style.top = (cy - TAM_CENTRO / 2) + 'px';

  const cnome = document.createElement('div');
  cnome.className = 'nome-fractal';
  cnome.textContent = miolo.nome || 'Sem nome';
  centro.appendChild(cnome);

  const nAnexos = (miolo.anexos || []).length;
  const csub = document.createElement('div');
  csub.className = 'sub-fractal';
  const infoCentro = [];
  if (metaAtiva) {
    infoCentro.push((metaAtiva.dias - metaAtiva.progresso) + ' dias');
    infoCentro.push(infoPrazoMeta(metaAtiva));
    if (metaAtiva.progresso >= metaAtiva.dias) {
      const dtPai = Estado.itemPai && Estado.itemPai.concluidoEm
        ? ' ' + formatarDataMeta(Estado.itemPai.concluidoEm) : '';
      infoCentro.push('concluído' + dtPai);
    }
  } else if (n > 0) {
    infoCentro.push(nConcluidos + '/' + n + (nConcluidos === 1 ? ' concluído' : ' concluídos'));
  }
  if (nAnexos > 0) infoCentro.push(nAnexos + ' anexo(s)');
  infoCentro.push('toque p/ editar');
  csub.textContent = infoCentro.join(' • ');
  centro.appendChild(csub);

  if (metaAtiva) {
    const progresso = document.createElement('div');
    progresso.className = 'progresso-meta';
    progresso.setAttribute('role', 'progressbar');
    progresso.setAttribute('aria-valuemin', '0');
    progresso.setAttribute('aria-valuemax', String(metaAtiva.dias));
    progresso.setAttribute('aria-valuenow', String(metaAtiva.progresso));
    const progressoPreenchido = document.createElement('span');
    progressoPreenchido.style.width = (metaAtiva.progresso / metaAtiva.dias * 100) + '%';
    progresso.appendChild(progressoPreenchido);
    centro.appendChild(progresso);
  }

  centro.addEventListener('click', () => {
    Som.centro();
    if (metaAtiva && Estado.itemPai) editarMetaItem(Estado.itemPai);
    else editarMiolo();
  });
  centro.addEventListener('contextmenu', e => {
    e.preventDefault();
    mostrarSheet('Centro: ' + (miolo.nome || 'Sem nome'), [
      { texto: 'Editar centro', acao: () => editarMiolo() },
      { texto: 'Nova meta', cor: 'sucesso', acao: novaMetaFluxo },
      { texto: 'Anexos do centro', acao: () => abrirAnexos(null) },
    ]);
  });
  area.appendChild(centro);

  /* itens em fractal */
  posicoes.forEach(({ item, dx, dy }) => {
    const meta = normalizarMeta(item.meta);
    const concluido = itemConcluido(item);
    const itemX = cx + dx;
    const itemY = cy + dy;
    const x = itemX - raioItem;
    const y = itemY - raioItem;
    const distancia = Math.hypot(dx, dy);
    if (distancia > 0) {
      const ux = dx / distancia;
      const uy = dy / distancia;
      const linha = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      linha.setAttribute('class', 'linha-fractal');
      linha.setAttribute('x1', cx + ux * (TAM_CENTRO / 2 + 2));
      linha.setAttribute('y1', cy + uy * (TAM_CENTRO / 2 + 2));
      linha.setAttribute('x2', itemX - ux * (TAM_ITEM / 2 + 2));
      linha.setAttribute('y2', itemY - uy * (TAM_ITEM / 2 + 2));
      conexoes.appendChild(linha);
    }

    // Meta tem cor padrão (dourado da marca); item comum usa a paleta.
    const [ca, cb] = meta ? COR_MIOLO : corDoItem(item.cor);
    const agregado = progressoAgregado(item);
    const el = document.createElement('div');
    el.className = 'item';
    if (meta) el.classList.add('meta');
    if (agregado) el.classList.add('tem-metas');
    if (concluido) el.classList.add('concluido');
    el.style.background = 'transparent';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (meta) el.style.setProperty('--progresso-meta', (meta.progresso / meta.dias * 100) + '%');
    else if (agregado) el.style.setProperty('--progresso-meta', (agregado.progresso / agregado.dias * 100) + '%');
    else if (concluido) el.style.setProperty('--progresso-meta', '100%');
    else if (item.miolo && item.miolo.itens.length > 0) {
      const total = item.miolo.itens.length;
      const feitos = item.miolo.itens.filter(i => itemConcluido(i)).length;
      el.style.setProperty('--progresso-meta', (feitos / total * 100) + '%');
    }

    const nome = document.createElement('div');
    nome.className = 'nome-fractal';
    nome.textContent = item.nome || '...';
    el.appendChild(nome);

    if (meta) {
      const etiquetaMeta = document.createElement('span');
      etiquetaMeta.className = 'etiqueta-meta';
      etiquetaMeta.textContent = 'META';
      el.appendChild(etiquetaMeta);
    }

    if (concluido) {
      const marca = document.createElement('span');
      marca.className = 'marca-concluida';
      marca.textContent = '✓';
      marca.title = 'Concluído';
      marca.setAttribute('aria-label', 'Concluído');
      el.appendChild(marca);
    }

    const subItens = item.miolo ? item.miolo.itens.length : 0;
    const subAnexos = item.miolo ? item.miolo.anexos.length : 0;
    const textoItens = subItens === 1 ? '1 item' : subItens + ' itens';
    let subTxt = '';
    if (meta) subTxt = 'restam ' + (meta.dias - meta.progresso) + ' dias';
    else if (agregado) subTxt = Math.round(agregado.progresso / agregado.dias * 100) + '%';
    else if (subItens > 0 && subAnexos > 0) subTxt = textoItens + ' • ' + subAnexos;
    else if (subAnexos > 0) subTxt = subAnexos + ' anexo(s)';
    else if (subItens > 0) subTxt = textoItens;
    if (concluido) {
      // Concluído mostra a data; em meta o "x/y dias" sai (anel/selo já indicam).
      const base = meta ? '' : subTxt;
      subTxt = (base ? base + ' • ' : '') + textoConclusao(item);
    }

    const sub = document.createElement('div');
    sub.className = 'sub-fractal';
    sub.textContent = subTxt;
    el.appendChild(sub);

    const ordem = document.createElement('span');
    ordem.className = 'menu-fractal';
    ordem.textContent = '\u22EF';
    el.appendChild(ordem);

    /* toque simples (entrar) com detecção de toque longo */
    let tLongo = null;
    let longoDisparado = false;
    let iniX = 0, iniY = 0;

    const limpar = () => { clearTimeout(tLongo); tLongo = null; };

    el.addEventListener('pointerdown', e => {
      longoDisparado = false;
      iniX = e.clientX; iniY = e.clientY;
      clearTimeout(tLongo);
      tLongo = setTimeout(() => {
        tLongo = null;
        longoDisparado = true;
        mostrarOpcoesItem(item);
      }, 520);
    });
    el.addEventListener('pointermove', e => {
      if (tLongo && (Math.abs(e.clientX - iniX) > 10 || Math.abs(e.clientY - iniY) > 10)) {
        clearTimeout(tLongo); tLongo = null;
      }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, limpar));

    el.addEventListener('click', () => {
      if (longoDisparado) { longoDisparado = false; return; }
      Som.item();
      entrarItem(item);
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      mostrarOpcoesItem(item);
    });

    area.appendChild(el);
  });

  aplicarEscala();
}

/* Faixa de deslocamento do grafico.
   Antes era um limite simetrico em torno do centro: a cada gesto ele
   centralizava a Flor, perdia o ponto focal da pinca e travava o arraste
   (um arrasto de 400px acabava valendo 25px). Agora so exigimos que uma
   margem do conteudo continue visivel, o que mantem o arraste livre. */
const MARGEM_PAN = 40;

function limitarPan(valor, tamanho, disponivel) {
  const min = MARGEM_PAN - tamanho;
  const max = disponivel - MARGEM_PAN;
  if (min > max) return (disponivel - tamanho) / 2;
  return Math.max(min, Math.min(max, valor));
}

function posicionarFlor(limitar = true) {
  const canvasEl = $('#flor-canvas');
  const viewport = $('#flor-viewport');
  if (!canvasEl || !viewport) return;

  const disponivelLargura = Math.max(1, canvasEl.clientWidth - 16);
  const disponivelAltura = Math.max(1, canvasEl.clientHeight - 16);
  const largura = viewport.offsetWidth;
  const altura = viewport.offsetHeight;
  // No zoom ancorado o pan e exato: limitar aqui devolveria o grafico para
  // o centro e a pinca pareceria focar sempre o fractal do meio.
  if (limitar) {
    Estado.panX = limitarPan(Estado.panX, largura, disponivelLargura);
    Estado.panY = limitarPan(Estado.panY, altura, disponivelAltura);
  }
  viewport.style.transform = 'translate(' + Estado.panX + 'px,' + Estado.panY + 'px)';
  canvasEl.classList.toggle(
    'ampliado',
    largura > disponivelLargura + 0.5 || altura > disponivelAltura + 0.5
  );
}

function aplicarEscala(preservarPonto = false, ponto = null) {
  const canvasEl = $('#flor-canvas');
  const viewport = $('#flor-viewport');
  const area = $('#flor-area');
  if (!canvasEl || !viewport || !area) return;

  const margem = 16;
  const disponivelLargura = Math.max(1, canvasEl.clientWidth - margem);
  const disponivelAltura = Math.max(1, canvasEl.clientHeight - margem);
  const escalaAnterior = Estado.escalaAplicada || 1;
  let focoX = Estado.larguraCanvas / 2;
  let focoY = Estado.alturaCanvas / 2;
  let alvoX = null;
  let alvoY = null;
  let origemX = 0;
  let origemY = 0;

  if (preservarPonto) {
    const rectCanvas = canvasEl.getBoundingClientRect();
    const rectArea = area.getBoundingClientRect();
    const estilos = getComputedStyle(canvasEl);
    origemX = rectCanvas.left + (parseFloat(estilos.paddingLeft) || 0);
    origemY = rectCanvas.top + (parseFloat(estilos.paddingTop) || 0);
    alvoX = ponto && Number.isFinite(ponto.x) ? ponto.x : rectCanvas.left + rectCanvas.width / 2;
    alvoY = ponto && Number.isFinite(ponto.y) ? ponto.y : rectCanvas.top + rectCanvas.height / 2;
    focoX = (alvoX - rectArea.left) / escalaAnterior;
    focoY = (alvoY - rectArea.top) / escalaAnterior;
  }

  const escalaTelaNatural = Math.min(
    disponivelLargura / Estado.larguraCanvas,
    disponivelAltura / Estado.alturaCanvas
  );
  const escalaTela = Estado.limiteEscalaTela === null
    ? escalaTelaNatural
    : Math.min(escalaTelaNatural, Estado.limiteEscalaTela);
  const escala = Math.max(0.01, Math.min(20, escalaTela * Estado.zoomUsuario));
  const larguraEscalada = Estado.larguraCanvas * escala;
  const alturaEscalada = Estado.alturaCanvas * escala;

  const temPonto = preservarPonto && alvoX !== null && alvoY !== null;
  if (temPonto) {
    // Resolve o pan para que o conteudo sob o dedo fique sob o dedo.
    Estado.panX = alvoX - origemX - focoX * escala;
    Estado.panY = alvoY - origemY - focoY * escala;
  } else {
    // Sem ponto (ao abrir uma tela): centraliza o conteudo.
    Estado.panX = (disponivelLargura - larguraEscalada) / 2;
    Estado.panY = (disponivelAltura - alturaEscalada) / 2;
  }

  viewport.style.width = larguraEscalada + 'px';
  viewport.style.height = alturaEscalada + 'px';
  area.style.transform = 'scale(' + escala + ')';
  Estado.escalaAplicada = escala;
  Estado.escalaTelaAplicada = escalaTela;
  posicionarFlor(!temPonto);
}

function alterarZoom(fator, ponto = null) {
  Estado.zoomUsuario = Math.max(0.5, Math.min(20, Estado.zoomUsuario * fator));
  aplicarEscala(true, ponto);
}

function renderizarControleMeta(meta) {
  const controle = $('#meta-controle');
  if (!controle) return;
  controle.hidden = !meta;
  if (!meta) return;

  const completo = meta.progresso >= meta.dias;
  const dtPai = Estado.itemPai && Estado.itemPai.concluidoEm
    ? formatarDataMeta(Estado.itemPai.concluidoEm) : '';
  $('#meta-progresso-valor').textContent = completo ? 'concluído' : (meta.dias - meta.progresso) + ' dias';
  $('#meta-progresso-prazo').textContent = completo && dtPai ? 'em ' + dtPai : infoPrazoMeta(meta);
  $('#meta-menos').disabled = meta.progresso <= 0;
  $('#meta-mais').disabled = meta.progresso >= meta.dias;
  $('#meta-concluir').disabled = meta.progresso >= meta.dias;
}

async function registrarProgressoMeta(delta) {
  const item = Estado.itemPai;
  if (!item || !item.meta) return;
  const meta = normalizarMeta(item.meta);
  const novoProgresso = Math.max(0, Math.min(meta.dias, meta.progresso + delta));
  if (novoProgresso === meta.progresso) return;
  meta.progresso = novoProgresso;
  item.meta = meta;
  const concluiu = novoProgresso >= meta.dias;
  marcarConcluido(item, concluiu);
  await guardar();
  renderizarFlor();
  if (concluiu) toast('Meta concluída.');
}

async function concluirMetaAtual() {
  const item = Estado.itemPai;
  if (!item || !item.meta) return;
  const meta = normalizarMeta(item.meta);
  meta.progresso = meta.dias;
  item.meta = meta;
  marcarConcluido(item, true);
  await guardar();
  renderizarFlor();
  toast('Meta concluída.');
}

/* ============================================================
 * Edição do centro / itens
 * ============================================================ */

function editarMiolo() {
  const miolo = mioloAtual();
  editar('Editar centro', miolo.nome, miolo.anotacoes, (nome, notas) => {
    miolo.nome = nome;
    miolo.anotacoes = notas;
    // O centro da raiz tambem da o nome ao projeto na lista de projetos.
    if (Estado.atual && miolo === Estado.atual.raiz) Estado.atual.nome = nome;
    guardar();
    renderizarFlor();
  });
}

function abrirEditorMeta(titulo, nome, dias, inicio, okTexto, prazoManual) {
  const hoje = dataLocalISO();
  const prazo = somarDias(inicio || hoje, dias || 30);
  const resultado = abrirModal(
    titulo,
    '<label for="meta-nome">Nome da meta</label>' +
    '<input class="campo" id="meta-nome" type="text" value="' + escapeHtml(nome || '') + '">' +
    '<label for="meta-dias">Duração estimada (dias)</label>' +
    '<input class="campo" id="meta-dias" type="number" min="1" max="3650" step="1" value="' + escapeHtml(dias || 30) + '">' +
    '<label for="meta-inicio">Data de início</label>' +
    '<input class="campo" id="meta-inicio" type="date" value="' + escapeHtml(inicio || hoje) + '">' +
    '<label for="meta-prazo-manual">Prazo manual (opcional)</label>' +
    '<input class="campo" id="meta-prazo-manual" type="date" value="' + escapeHtml(prazoManual || '') + '">' +
    '<p id="meta-previsao" style="margin:14px 0 0;color:#8B98A8;font-size:12px">Prazo previsto: ' + escapeHtml(formatarDataMeta(prazo)) + '</p>',
    okTexto
  );

  const atualizarPrevisao = () => {
    const diasInformados = Math.floor(Number($('#meta-dias').value));
    const inicioInformado = $('#meta-inicio').value || hoje;
    const previsao = $('#meta-previsao');
    if (!Number.isFinite(diasInformados) || diasInformados < 1) {
      previsao.textContent = 'Informe uma duração válida.';
      return;
    }
    previsao.textContent = 'Prazo previsto: ' + formatarDataMeta(somarDias(inicioInformado, diasInformados));
  };
  const atualizarDiasPrazo = () => {
    const prazoManual = $('#meta-prazo-manual').value;
    const inicioInformado = $('#meta-inicio').value || hoje;
    if (!prazoManual || !/^\d{4}-\d{2}-\d{2}$/.test(prazoManual)) return;
    const inicio = new Date(inicioInformado + 'T12:00:00');
    const prazo = new Date(prazoManual + 'T12:00:00');
    const diff = Math.round((prazo - inicio) / 86400000);
    if (diff >= 1) {
      $('#meta-dias').value = diff;
      atualizarPrevisao();
    }
  };
  $('#meta-dias').addEventListener('input', atualizarPrevisao);
  $('#meta-inicio').addEventListener('input', atualizarPrevisao);
  $('#meta-prazo-manual').addEventListener('input', atualizarDiasPrazo);

  return resultado.then(res => {
    if (res !== 'ok') return null;
    return {
      nome: ($('#meta-nome').value || '').trim(),
      dias: Math.floor(Number($('#meta-dias').value)),
      inicio: $('#meta-inicio').value || hoje,
      prazoManual: $('#meta-prazo-manual').value || '',
    };
  });
}

async function novaMetaFluxo() {
  const dados = await abrirEditorMeta('Nova meta', '', 30, dataLocalISO(), 'Criar');
  // O fluxo é concluído por novoConfirmacaoMeta abaixo, mantendo o mesmo modal global.
  if (!dados) return;
  await novoConfirmacaoMeta(dados);
}

async function novoConfirmacaoMeta(dados) {
  const nome = String(dados.nome || '').trim();
  const dias = Math.floor(Number(dados.dias));
  if (!nome || !Number.isFinite(dias) || dias < 1) {
    toast('Informe um nome e uma duração válida.');
    return;
  }
  const miolo = mioloAtual();
  const item = novoItem(nome, miolo.itens.length);
  item.meta = criarMeta(dias, dados.inicio);
  item.meta.prazoManual = dados.prazoManual || '';
  miolo.itens.push(item);
  await guardar();
  renderizarFlor();
  toast('Meta criada.');
}

async function editarMetaItem(item) {
  const meta = normalizarMeta(item.meta);
  if (!meta) return;
  const dados = await abrirEditorMeta('Editar meta', item.nome, meta.dias, meta.inicio, 'Salvar', meta.prazoManual);
  if (!dados) return;
  const nome = String(dados.nome || '').trim();
  const dias = Math.floor(Number(dados.dias));
  if (!nome || !Number.isFinite(dias) || dias < 1) {
    toast('Informe um nome e uma duração válida.');
    return;
  }
  meta.dias = dias;
  meta.progresso = Math.min(meta.progresso, dias);
  meta.inicio = dados.inicio;
  meta.prazo = somarDias(meta.inicio, dias);
  meta.prazoManual = dados.prazoManual || '';
  item.nome = nome;
  item.miolo.nome = nome;
  item.meta = meta;
  marcarConcluido(item, meta.progresso >= meta.dias);
  await guardar();
  renderizarFlor();
  toast('Meta atualizada.');
}

async function transformarEmMeta(item) {
  const dados = await abrirEditorMeta('Transformar em meta', item.nome, 30, dataLocalISO(), 'Criar meta', '');
  if (!dados) return;
  const nome = String(dados.nome || '').trim();
  const dias = Math.floor(Number(dados.dias));
  if (!nome || !Number.isFinite(dias) || dias < 1) {
    toast('Informe um nome e uma duração válida.');
    return;
  }
  item.nome = nome;
  item.miolo.nome = nome;
  item.meta = criarMeta(dias, dados.inicio);
  item.meta.prazoManual = dados.prazoManual || '';
  marcarConcluido(item, false);
  await guardar();
  renderizarFlor();
  toast('Item transformado em meta.');
}

function mostrarOpcoesItem(item) {
  const nome = item.nome || '...';
  const meta = normalizarMeta(item.meta);
  const opcaoMeta = meta
    ? { texto: 'Editar meta', acao: () => editarMetaItem(item) }
    : {
        texto: 'Transformar em meta',
        cor: 'sucesso',
        acao: () => transformarEmMeta(item),
      };
  const opcaoConclusao = meta
    ? (meta.progresso >= meta.dias || itemConcluido(item)
        ? {
            texto: 'Reabrir meta',
            acao: async () => {
              meta.progresso = Math.max(0, meta.dias - 1);
              item.meta = meta;
              marcarConcluido(item, false);
              await guardar();
              renderizarFlor();
              toast('Meta reaberta.');
            },
          }
        : {
            texto: 'Concluir meta',
            cor: 'sucesso',
            acao: async () => {
              meta.progresso = meta.dias;
              item.meta = meta;
              marcarConcluido(item, true);
              Som.centro();
              await guardar();
              renderizarFlor();
              toast('Meta concluída.');
            },
          })
    : (item.concluido === true
        ? {
            texto: 'Reabrir item',
            acao: async () => {
              marcarConcluido(item, false);
              await guardar();
              renderizarFlor();
              toast('Item reaberto.');
            },
          }
        : {
            texto: 'Marcar como concluído',
            cor: 'sucesso',
            acao: async () => {
              Som.centro();
              marcarConcluido(item, true);
              await guardar();
              renderizarFlor();
              toast('Item concluído.');
            },
          });

  mostrarSheet('Item: ' + nome, [
    {
      texto: 'Editar item',
      acao: () => editar('Editar item', item.nome, item.anotacoes || '', (n, notas) => {
        item.nome = n;
        if (item.miolo) item.miolo.nome = n;
        item.anotacoes = notas;
        guardar();
        renderizarFlor();
      }),
    },
    { texto: 'Anexos', acao: () => abrirAnexos(item) },
    opcaoMeta,
    opcaoConclusao,
    {
      texto: 'Apagar item',
      cor: 'danger',
      acao: () => confirmar('Apagar item', 'Apagar "' + nome + '" e tudo o que existe dentro dele?', () => {
        const miolo = mioloAtual();
        miolo.itens = miolo.itens.filter(i => i !== item);
        guardar();
        renderizarFlor();
        toast('Item apagado.');
      }),
    },
  ]);
}

function novoItemFluxo() {
  prompt('Novo item', 'Nome do item:', '', '', nome => {
    const miolo = mioloAtual();
    miolo.itens.push(novoItem(nome.trim(), miolo.itens.length));
    guardar();
    renderizarFlor();
  });
}

/* ============================================================
 * ANEXOS
 * ============================================================ */

function abrirAnexos(item) {
  const miolo = item ? (item.miolo || (item.miolo = novoMiolo(item.nome))) : mioloAtual();
  Estado.anexosDe = miolo;
  Estado.anexosTitulo = (item ? (item.nome || 'Item') : (miolo.nome || 'Centro'));
  mostrarTela('anexos');
  renderizarAnexos();
}

const ICONES_ANEXO = {
  imagem:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="4.5" width="18" height="15" rx="2.6"/>' +
    '<circle cx="8.7" cy="10" r="1.6"/>' +
    '<path d="M4 17l4.6-4.2a1.6 1.6 0 0 1 2.2 0L14 16"/>' +
    '<path d="M13.2 15.2l1.8-1.7a1.6 1.6 0 0 1 2.2 0l2.8 2.6"/></svg>',
  video:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="5" width="18" height="14" rx="2.6"/>' +
    '<path d="M10.3 9.2l4.7 2.8-4.7 2.8z" fill="currentColor" stroke-width="1.2"/></svg>',
  link:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10.3 13.7a4 4 0 0 0 5.7 0l2.7-2.7a4 4 0 0 0-5.7-5.7l-1.2 1.2"/>' +
    '<path d="M13.7 10.3a4 4 0 0 0-5.7 0l-2.7 2.7a4 4 0 0 0 5.7 5.7l1.2-1.2"/></svg>',
  arquivo:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 3.5H7.8A2.3 2.3 0 0 0 5.5 5.8v12.4a2.3 2.3 0 0 0 2.3 2.3h8.4a2.3 2.3 0 0 0 2.3-2.3V8z"/>' +
    '<path d="M14 3.5V8h4.5"/><path d="M9 12.6h6"/><path d="M9 16h4"/></svg>',
};

function iconeAnexo(tipo) {
  return ICONES_ANEXO[tipo] || ICONES_ANEXO.arquivo;
}

// URLs das miniaturas da renderizacao atual, para liberar memoria ao redesenhar.
let urlsMiniaturas = [];

function soltarMiniaturas() {
  urlsMiniaturas.forEach(url => URL.revokeObjectURL(url));
  urlsMiniaturas = [];
}

async function aplicarMiniatura(el, anexo) {
  if (!el || anexo.tipo !== 'imagem' || !anexo.arquivo) return;
  try {
    const blob = await Storage.pegarArquivo(anexo.id);
    if (!blob || !el.isConnected) return;
    const url = URL.createObjectURL(blob);
    urlsMiniaturas.push(url);
    el.style.backgroundImage = 'url("' + url + '")';
    el.classList.add('com-foto');
  } catch (err) { /* sem miniatura: segue com o icone */ }
}

function renderizarAnexos() {
  const miolo = Estado.anexosDe;
  if (!miolo) { irParaLista(); return; }

  $('#anexos-titulo').innerHTML = '<b>' + escapeHtml(Estado.anexosTitulo) + '</b>';

  soltarMiniaturas();

  const container = $('#anexos-container');
  const vazio = $('#anexos-vazio');
  container.innerHTML = '';
  container.appendChild(vazio);
  vazio.style.display = miolo.anexos.length === 0 ? '' : 'none';

  const lista = [...miolo.anexos].sort((a, b) => (b.adicionado || '').localeCompare(a.adicionado || ''));

  lista.forEach(anexo => {
    const el = document.createElement('div');
    el.className = 'item-anexo tipo-' + (anexo.tipo || 'arquivo');

    const miniatura = document.createElement('div');
    miniatura.className = 'miniatura-anexo tipo-' + (anexo.tipo || 'arquivo');
    miniatura.innerHTML = iconeAnexo(anexo.tipo);
    aplicarMiniatura(miniatura, anexo);

    const dados = document.createElement('div');
    dados.className = 'dados-anexo';

    const nome = document.createElement('div');
    nome.className = 'nome';
    nome.textContent = anexo.nome || (ehLink(anexo.valor) ? anexo.valor : 'anexo');

    const valor = document.createElement('div');
    valor.className = 'valor';
    valor.textContent = anexo.valor || '';
    if (valor.textContent && valor.textContent !== nome.textContent) dados.appendChild(valor);

    const meta = document.createElement('div');
    meta.className = 'meta-anexo';
    const etiqueta = document.createElement('span');
    etiqueta.className = 'etiqueta-anexo ' + anexo.tipo;
    etiqueta.textContent = rotuloAnexo(anexo.tipo);
    meta.appendChild(etiqueta);
    if (anexo.adicionado) {
      const data = document.createElement('span');
      data.className = 'data';
      data.textContent = dataAmigavel(anexo.adicionado);
      meta.appendChild(data);
    }

    dados.insertBefore(nome, dados.firstChild);
    dados.appendChild(meta);

    const remover = document.createElement('button');
    remover.className = 'botao-remover-anexo';
    remover.innerHTML = '&times;';
    remover.title = 'Remover';
    remover.setAttribute('aria-label', 'Remover anexo');
    remover.addEventListener('click', e => {
      e.stopPropagation();
      confirmar('Remover anexo', 'Remover "' + (anexo.nome || 'anexo') + '" deste item?', async () => {
        miolo.anexos = miolo.anexos.filter(a => a !== anexo);
        if (anexo.arquivo) await Storage.apagarArquivo(anexo.id).catch(() => {});
        await guardar();
        renderizarAnexos();
        toast('Anexo removido.');
      });
    });

    el.appendChild(miniatura);
    el.appendChild(dados);
    el.appendChild(remover);
    el.addEventListener('click', () => abrirAnexo(anexo));
    container.appendChild(el);
  });
}

function rotuloAnexo(tipo) {
  switch (tipo) {
    case 'imagem': return 'IMG';
    case 'video': return 'VID';
    case 'link': return 'LINK';
    case 'arquivo': return 'ARQ';
    default: return '?';
  }
}

async function abrirAnexo(anexo) {
  if (ehLink(anexo.valor)) {
    window.open(anexo.valor, '_blank', 'noopener');
    return;
  }
  const blob = anexo.arquivo ? await Storage.pegarArquivo(anexo.id) : null;
  if (!blob) {
    toast(anexo.arquivo && typeof GoogleAuth !== 'undefined' && GoogleAuth.logado()
      ? 'Arquivo ainda não baixado. Sincronize para buscar do Drive.'
      : 'Arquivo não encontrado.');
    return;
  }
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function fluxoAdicionarAnexo(tipo) {
  if (tipo === 'video') {
    mostrarSheet('Vídeo', [
      { texto: 'Link do vídeo (YouTube, Drive...)', acao: () => pedirLink('Vídeo', 'video') },
      { texto: 'Arquivo de vídeo do dispositivo', acao: () => adicionarAnexoArquivo('video', ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'mpg', 'mpeg']) },
    ]);
    return;
  }
  if (tipo === 'link') { pedirLink('Link', 'link'); return; }
  if (tipo === 'imagem') adicionarAnexoArquivo('imagem', ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']);
  if (tipo === 'arquivo') adicionarAnexoArquivo('arquivo', null);
}

function adicionarAnexoArquivo(tipo, extPermitidas) {
  const input = $('#input-arquivo');
  input.accept = extPermitidas ? extPermitidas.map(e => '.' + e).join(',') : '';
  input.value = '';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const miolo = Estado.anexosDe;
    if (!file.type && extPermitidas && !extPermitidas.includes(extDe(file.name).slice(1))) {
      toast('Formato não permitido.');
      return;
    }
    const id = novoId();
    await Storage.guardarArquivo(id, file);
    miolo.anexos.push({
      id,
      nome: file.name,
      tipo,
      valor: file.name,
      adicionado: new Date().toISOString(),
      arquivo: true,
    });
    await guardar();
    renderizarAnexos();
    toast('Anexo adicionado.');
  };
  input.click();
}

function pedirLink(titulo, tipo) {
  prompt(titulo, 'Cole o endereço:', '', '', async texto => {
    let v = texto.trim();
    if (!v || v === 'https://') return;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    let url;
    try { url = new URL(v); } catch { toast('Endereço inválido.'); return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { toast('Endereço inválido.'); return; }

    const miolo = Estado.anexosDe;
    miolo.anexos.push({
      id: novoId(),
      nome: url.hostname,
      tipo: tipo === 'video' ? 'video' : 'link',
      valor: url.href,
      adicionado: new Date().toISOString(),
      arquivo: false,
    });
    await guardar();
    renderizarAnexos();
    toast('Link adicionado.');
  });
}

/* ============================================================
 * MODAIS (promise única, botões fixos)
 * ============================================================ */

let modalResolve = null;

function abrirModal(titulo, corpoHTML, okTexto) {

  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = corpoHTML;
  $('#modal-ok').textContent = okTexto || 'OK';
  $('#modal-ok').className = 'btn btn-primario';
  $('#modal-overlay').hidden = false;
  return new Promise(resolve => { modalResolve = resolve; });
}

function resolverModal(valor) {

  const r = modalResolve;
  modalResolve = null;
  $('#modal-overlay').hidden = true;
  if (r) r(valor);
}

function prompt(titulo, rotulo, placeholder, inicial, aoOk) {
  abrirModal(titulo,
    '<label for="inp">' + escapeHtml(rotulo) + '</label>' +
    '<input class="campo" id="inp" type="text" placeholder="' + escapeHtml(placeholder || '') + '" value="' + escapeHtml(inicial || '') + '">'
  ).then(res => {
    if (res !== 'ok') return;
    const v = ($('#inp').value || '').trim();
    if (v) aoOk(v);
    else toast('Escreva um valor.');
  });
}

function editar(titulo, nome, notas, aoGuardar) {
  abrirModal(titulo,
    '<label for="e-nome">Nome</label>' +
    '<input class="campo" id="e-nome" type="text" value="' + escapeHtml(nome || '') + '">' +
    '<label for="e-notas">Anotações</label>' +
    '<textarea class="campo" id="e-notas">' + escapeHtml(notas || '') + '</textarea>'
  ).then(res => {
    if (res !== 'ok') return;
    const nomeLimpo = ($('#e-nome').value || '').trim();
    if (!nomeLimpo) { toast('O nome não pode ficar vazio.'); return; }
    aoGuardar(nomeLimpo, ($('#e-notas').value || '').trim());
  });
}

function confirmar(titulo, msg, aoSim) {
  abrirModal(titulo, '<p style="margin:0;color:#C9D4E3">' + msg + '</p>', 'Sim')
    .then(res => { if (res === 'ok') aoSim(); });
}

function mostrarSheet(titulo, opcoes) {
  $('#sheet-titulo').textContent = titulo;
  const cont = $('#sheet-opcoes');
  cont.innerHTML = '';
  opcoes.forEach(op => {
    const b = document.createElement('button');
    b.className = 'sheet-opcao' +
      (op.cor === 'danger' ? ' danger' : op.cor === 'sucesso' ? ' sucesso' : '');
    b.textContent = op.texto;
    b.addEventListener('click', () => {
      fecharSheet();
      op.acao();
    });
    cont.appendChild(b);
  });
  $('#sheet-overlay').hidden = false;
}

function fecharSheet() {
  $('#sheet-overlay').hidden = true;
}

/* ============================================================
 * IMPORTAR / EXPORTAR
 * ============================================================ */

async function exportarProjetoAtual() {
  if (!Estado.atual) { toast('Nenhum projeto aberto.'); return; }
  const blob = await exportarProjeto(Estado.atual);
  baixarArquivo(nomeArquivoSeguro(Estado.atual.nome) + '.fractal', blob);
  toast('Projeto exportado (.fractal).');
}

async function exportarTudo() {
  const todos = await Storage.listarProjetos();
  if (todos.length === 0) { toast('Nada para exportar.'); return; }
  const conteudo = [];
  for (const proj of todos) {
    const texto = await (await exportarProjeto(proj)).text();
    conteudo.push({ _projeto: proj.nome, doc: JSON.parse(texto) });
  }
  const blob = new Blob([JSON.stringify(conteudo, null, 2)], { type: 'application/json' });
  baixarArquivo('fractal_backup_' + new Date().toISOString().slice(0, 10) + '.json', blob);
  toast('Backup exportado (' + todos.length + ' projeto(s)).');
}

function nomeArquivoSeguro(nome) {
  return String(nome || 'projeto').replace(/[\\/:*?"<>|]/g, '_').trim() || 'projeto';
}

function importarFluxo() {
  const input = $('#input-importar');
  input.value = '';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const texto = await file.text();
      const dados = JSON.parse(texto);
      const lista = Array.isArray(dados) ? dados : [dados];
      let cont = 0;
      for (const item of lista) {
        await importarProjeto(item && item.doc ? item.doc : item);
        cont++;
      }
      await recarregarProjetos();
      if (typeof Sync !== 'undefined' && Sync && Sync.marcarSujo) Sync.marcarSujo();
      toast('Importado: ' + cont + ' projeto(s).');
    } catch (err) {
      toast('Não foi possível importar: ' + err.message);
    }
  };
  input.click();
}

/* ============================================================
 * Eventos
 * ============================================================ */

function wire() {
  $('#btn-novo-projeto').addEventListener('click', () => {
    prompt('Novo projeto', 'Dê um nome ao projeto:', '', '', async nome => {
      const projeto = {
        id: novoId(),
        nome: nome.trim(),
        modificado: new Date().toISOString(),
        raiz: novoMiolo(nome.trim()),
      };
      await Storage.salvarProjeto(projeto);
      await recarregarProjetos();
      if (typeof Sync !== 'undefined' && Sync && Sync.marcarSujo) Sync.marcarSujo();
      irParaFlor(projeto);
    });
  });

  $('#btn-importar').addEventListener('click', importarFluxo);
  $('#btn-exportar-tudo').addEventListener('click', exportarTudo);
  $('#btn-som').addEventListener('click', () => {
    const ligado = Som.alternar();
    $('#btn-som').textContent = ligado ? 'Som: ligado' : 'Som: desligado';
    if (ligado) toast('Som ativado.');
    else toast('Som desativado.');
  });
  $('#btn-voltar').addEventListener('click', voltar);
  $('#btn-novo-item').addEventListener('click', novoItemFluxo);
  $('#btn-anexos').addEventListener('click', () => abrirAnexos(null));
  $('#btn-exportar').addEventListener('click', exportarProjetoAtual);
  $('#btn-guardar').addEventListener('click', async () => {
    await guardar();
    toast('Guardado.');
  });
  $('#btn-anexos-voltar').addEventListener('click', () => {
    mostrarTela('flor');
    renderizarFlor();
  });

  const canvasFlor = $('#flor-canvas');
  let arrasto = null;
  const ponteiros = new Map();
  let pinca = null;

  function dadosPinca() {
    const lista = Array.from(ponteiros.values());
    if (lista.length < 2) return null;
    return {
      distancia: Math.hypot(lista[0].x - lista[1].x, lista[0].y - lista[1].y),
      centro: { x: (lista[0].x + lista[1].x) / 2, y: (lista[0].y + lista[1].y) / 2 }
    };
  }

  function iniciarArrastoUnico() {
    const lista = Array.from(ponteiros.values());
    arrasto = lista.length === 1
      ? {
        id: lista[0].id,
        inicioX: lista[0].x,
        inicioY: lista[0].y,
        panX: Estado.panX,
        panY: Estado.panY,
        ativo: false
      }
      : null;
  }

  canvasFlor.addEventListener('wheel', e => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    alterarZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX, y: e.clientY });
  }, { passive: false });

  canvasFlor.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    ponteiros.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });

    // Pinça: vale mesmo sem transbordo, porque serve para aproximar.
    if (ponteiros.size >= 2) {
      arrasto = null;
      pinca = dadosPinca();
      canvasFlor.classList.remove('arrastando');
      Estado.arrastouFlor = true;
      return;
    }

    // O arraste vale mesmo sem transbordo: com o limite corrigido sempre ha
    // para onde mover o grafico.
    Estado.arrastouFlor = false;
    iniciarArrastoUnico();
  });

  canvasFlor.addEventListener('pointermove', e => {
    if (!ponteiros.has(e.pointerId)) return;
    ponteiros.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });

    if (ponteiros.size >= 2) {
      const atual = dadosPinca();
      if (pinca && atual && pinca.distancia > 0) {
        const fator = atual.distancia / pinca.distancia;
        if (Number.isFinite(fator) && fator > 0) {
          alterarZoom(fator, atual.centro);
          Estado.arrastouFlor = true;
        }
      }
      pinca = atual;
      e.preventDefault();
      return;
    }

    if (!arrasto || arrasto.id !== e.pointerId) return;
    const dx = e.clientX - arrasto.inicioX;
    const dy = e.clientY - arrasto.inicioY;
    if (!arrasto.ativo && Math.hypot(dx, dy) < 8) return;

    if (!arrasto.ativo) {
      arrasto.ativo = true;
      Estado.arrastouFlor = true;
      canvasFlor.classList.add('arrastando');
      try { canvasFlor.setPointerCapture(e.pointerId); } catch (_) {}
    }

    Estado.panX = arrasto.panX + dx;
    Estado.panY = arrasto.panY + dy;
    posicionarFlor();
    e.preventDefault();
  });

  function finalizarArrasto(e) {
    if (e && e.pointerId !== undefined) ponteiros.delete(e.pointerId);
    else ponteiros.clear();

    // Ainda ha dois dedos: a pinça continua.
    if (ponteiros.size >= 2) { pinca = dadosPinca(); return; }
    pinca = null;

    // Sobrou um dedo: recomeca o arraste da posicao atual, sem salto.
    if (ponteiros.size === 1) {
      Estado.arrastouFlor = true;
      iniciarArrastoUnico();
      return;
    }

    arrasto = null;
    canvasFlor.classList.remove('arrastando');
    // Nao reaplica o limite de pan aqui. Medido no emulador: durante a pinca
    // o ponto focal e exato, e limitar no fim do gesto puxava o grafico de
    // volta (63 px de salto) destruindo o foco. O limite continua valendo
    // durante o arraste com um dedo, em posicionarFlor().
    if (e && e.type === 'pointercancel') Estado.arrastouFlor = false;
  }

  canvasFlor.addEventListener('pointerup', finalizarArrasto);
  canvasFlor.addEventListener('pointercancel', finalizarArrasto);
  // NAO escuta 'lostpointercapture' aqui. No WebView do Android ele dispara
  // logo apos o setPointerCapture do primeiro pointermove; tratar isso como
  // fim de gesto zerava o arasto no primeiro movimento. A captura e liberada
  // sozinha em pointerup/pointercancel.
  window.addEventListener('pointerup', finalizarArrasto);
  window.addEventListener('pointercancel', finalizarArrasto);
  canvasFlor.addEventListener('click', e => {
    if (!Estado.arrastouFlor) return;
    e.preventDefault();
    e.stopPropagation();
    Estado.arrastouFlor = false;
  }, true);

  $('#meta-menos').addEventListener('click', () => registrarProgressoMeta(-1));
  $('#meta-mais').addEventListener('click', () => registrarProgressoMeta(1));
  $('#meta-concluir').addEventListener('click', concluirMetaAtual);
  $('#meta-progresso').addEventListener('click', () => {
    if (Estado.itemPai && Estado.itemPai.meta) editarMetaItem(Estado.itemPai);
  });

  document.querySelectorAll('[data-icone]').forEach(el => {
    el.innerHTML = iconeAnexo(el.dataset.icone);
  });

  document.querySelectorAll('[data-anexo-tipo]').forEach(b => {
    b.addEventListener('click', () => fluxoAdicionarAnexo(b.dataset.anexoTipo));
  });

  $('#sheet-fechar').addEventListener('click', fecharSheet);
  $('#sheet-overlay').addEventListener('click', e => { if (e.target.id === 'sheet-overlay') fecharSheet(); });
  $('#modal-overlay').addEventListener('click', e => {
    if (e.target.id !== 'modal-overlay') return;
    // Com foco dentro do diálogo, o fundo nunca cancela (só botão/voltar).
    // + ignora o clique do próprio toque que focou (pulo entre down e up).
    const focado = document.activeElement;
    const focadoNoModal = focado && document.getElementById('modal-overlay').contains(focado);
    const recente = Date.now() - ultimoFocusModal <= 1500;

    if (focadoNoModal || recente) return;

    resolverModal(null);
  });
  $('#modal-ok').addEventListener('click', () => resolverModal('ok'));
  $('#modal-cancelar').addEventListener('click', () => resolverModal(null));

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (tratarVoltar()) e.preventDefault();
  });

  if ('ResizeObserver' in window) {
    Estado.observadorTamanho = new ResizeObserver(() => {
      if (Estado.tela === 'flor') aplicarEscala(true);
    });
    Estado.observadorTamanho.observe($('#flor-canvas'));
  }
  window.addEventListener('resize', () => {
    if (Estado.tela === 'flor') aplicarEscala(true);
  });

  /* Teclado virtual 1: espelha a altura no --kb enquanto ele anima. */
  (function () {
    const vv = window.visualViewport;
    if (!vv) return;
    const medir = () => {
      const kb = Math.max(0, (window.innerHeight || 0) - vv.height);
      document.documentElement.style.setProperty('--kb', kb + 'px');
    };
    vv.addEventListener('resize', medir);
    vv.addEventListener('scroll', medir);
    medir();
  })();

  /* Teclado virtual 2: garante o campo visível mesmo quando a janela não
     redimensiona (WebView/tablet). Mede, estima em último caso e levanta o
     overlay via --kb-local; só em ponteiro touch. */
  let ultimoFocusModal = 0;
  (function () {
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const ehCampo = el => el && (el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && /^(text|number|date|password|search|tel|url|email)$/i.test(el.type || 'text')));
    const medirKb = () => {
      const layoutH = window.innerHeight || 0;
      const vv = window.visualViewport;
      const visH = vv ? vv.height : layoutH;
      // Arredonda: resíduos subpixel (ex. 0.14px) não são teclado.
      let kb = Math.max(0, Math.round(layoutH - visH));
      if (kb <= 0 && touch) {
        const telaH = (window.screen && window.screen.height) || 0;
        // Janela cheia = teclado por cima -> estima 40% da altura.
        if (!(telaH > layoutH * 1.15)) kb = Math.round(layoutH * 0.4);
      }
      return kb;
    };
    document.addEventListener('focusin', e => {
      const campo = e.target && ehCampo(e.target) ? e.target : null;
      const overlay = e.target && e.target.closest ? e.target.closest('.modal-overlay') : null;
      if (!campo || !overlay) return;
      // Marca o instante: o diálogo pode mudar de lugar (topo) entre o
      // pressionar e o soltar do dedo; o clique no fundo nesse intervalo
      // deve ser ignorado para não cancelar o diálogo sem querer.
      ultimoFocusModal = Date.now();
      const kb = medirKb();
      overlay.style.setProperty('--kb-local', kb + 'px');

      setTimeout(() => {
        overlay.style.setProperty('--kb-local', medirKb() + 'px');
        try { campo.scrollIntoView({ block: 'nearest' }); } catch (err) {}
      }, 350);
    });
    document.addEventListener('focusout', () => {
      // Adia o retorno visual: tirar o ajuste na hora move o diálogo entre
      // o pressionar e o soltar do dedo e o toque no OK cai no vazio
      // (vira "precisa de 2 OKs"). Só recolhe se o foco saiu do diálogo.
      setTimeout(() => {
        const ae = document.activeElement;
        if (ae && ae.closest && ae.closest('.modal-overlay')) return;
        document.querySelectorAll('.modal-overlay').forEach(o => {
          o.style.removeProperty('--kb-local');
        });
      }, 400);
    });
  })();

}

/* ============================================================
 * Inicialização
 * ============================================================ */

async function iniciar() {
  try {
    wire();
    document.documentElement.dataset.wired = '1';
    $('#btn-som').textContent = Som.ligado() ? 'Som: ligado' : 'Som: desligado';
    registrarServiceWorker();
    Estado.projetos = await Storage.listarProjetos();
    document.documentElement.dataset.listed = '1';
    mostrarTela('lista');
    renderizarLista();
    const marcadorVersao = $('#versao-app');
    if (marcadorVersao) marcadorVersao.textContent = 'v' + VERSAO_APP;
    document.documentElement.dataset.ready = '1';
  } catch (err) {
    document.documentElement.dataset.initerr = String(err && err.message || err);
    mostrarErroTela(String(err && err.message || err));
  }
}

iniciar();