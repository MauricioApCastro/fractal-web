'use strict';
document.documentElement.dataset.loadedjs = '1';

/* ============================================================
 * Fractal - lógica da interface
 * ============================================================ */

const $ = sel => document.querySelector(sel);

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
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ============================================================
 * Som de toque nos círculos (Web Audio - sem arquivos)
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
 * FLOR (CÍRCULOS)
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
  return {
    dias,
    progresso,
    inicio,
    prazo,
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

function itemConcluido(item) {
  const meta = normalizarMeta(item.meta);
  return item.concluido === true || (meta && meta.progresso >= meta.dias);
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
  conexoes.setAttribute('class', 'conexoes-circulo');
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
  centro.style.background = 'linear-gradient(135deg, ' + COR_MIOLO[0] + ', ' + COR_MIOLO[1] + ')';
  centro.style.left = (cx - TAM_CENTRO / 2) + 'px';
  centro.style.top = (cy - TAM_CENTRO / 2) + 'px';

  const cnome = document.createElement('div');
  cnome.className = 'nome-circulo';
  cnome.textContent = miolo.nome || 'Sem nome';
  centro.appendChild(cnome);

  const nAnexos = (miolo.anexos || []).length;
  const csub = document.createElement('div');
  csub.className = 'sub-circulo';
  const infoCentro = [];
  if (metaAtiva) {
    infoCentro.push(metaAtiva.progresso + '/' + metaAtiva.dias + ' dias');
    infoCentro.push('prazo: ' + formatarDataMeta(metaAtiva.prazo));
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

  centro.addEventListener('click', () => { Som.centro(); editarMiolo(); });
  centro.addEventListener('contextmenu', e => {
    e.preventDefault();
    mostrarSheet('Centro: ' + (miolo.nome || 'Sem nome'), [
      { texto: 'Editar centro', acao: () => editarMiolo() },
      { texto: 'Nova meta', cor: 'sucesso', acao: novaMetaFluxo },
      { texto: 'Anexos do centro', acao: () => abrirAnexos(null) },
    ]);
  });
  area.appendChild(centro);

  /* itens em círculo */
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
      linha.setAttribute('class', concluido ? 'linha-circulo concluida' : 'linha-circulo');
      linha.setAttribute('x1', cx + ux * (TAM_CENTRO / 2 + 2));
      linha.setAttribute('y1', cy + uy * (TAM_CENTRO / 2 + 2));
      linha.setAttribute('x2', itemX - ux * (TAM_ITEM / 2 + 2));
      linha.setAttribute('y2', itemY - uy * (TAM_ITEM / 2 + 2));
      conexoes.appendChild(linha);
    }

    const [ca, cb] = corDoItem(item.cor);
    const el = document.createElement('div');
    el.className = 'item';
    if (meta) el.classList.add('meta');
    if (concluido) el.classList.add('concluido');
    el.style.background = 'linear-gradient(135deg, ' + ca + ', ' + cb + ')';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (meta) el.style.setProperty('--progresso-meta', (meta.progresso / meta.dias * 100) + '%');

    const nome = document.createElement('div');
    nome.className = 'nome-circulo';
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
    if (meta) subTxt = meta.progresso + '/' + meta.dias + ' dias';
    else if (subItens > 0 && subAnexos > 0) subTxt = textoItens + ' • ' + subAnexos;
    else if (subAnexos > 0) subTxt = subAnexos + ' anexo(s)';
    else if (subItens > 0) subTxt = textoItens;

    const sub = document.createElement('div');
    sub.className = 'sub-circulo';
    sub.textContent = subTxt;
    el.appendChild(sub);

    const ordem = document.createElement('span');
    ordem.className = 'menu-circulo';
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

function limitarPan(valor, tamanho, disponivel) {
  const diferenca = tamanho - disponivel;
  if (diferenca <= 0) return (disponivel - tamanho) / 2;
  const limite = diferenca / 2;
  return Math.max(-limite, Math.min(limite, valor));
}

function posicionarFlor() {
  const canvasEl = $('#flor-canvas');
  const viewport = $('#flor-viewport');
  if (!canvasEl || !viewport) return;

  const disponivelLargura = Math.max(1, canvasEl.clientWidth - 16);
  const disponivelAltura = Math.max(1, canvasEl.clientHeight - 16);
  const largura = viewport.offsetWidth;
  const altura = viewport.offsetHeight;
  Estado.panX = limitarPan(Estado.panX, largura, disponivelLargura);
  Estado.panY = limitarPan(Estado.panY, altura, disponivelAltura);
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

  if (preservarPonto && alvoX !== null && alvoY !== null) {
    Estado.panX = alvoX - origemX - focoX * escala;
    Estado.panY = alvoY - origemY - focoY * escala;
  } else {
    Estado.panX = 0;
    Estado.panY = 0;
  }

  viewport.style.width = larguraEscalada + 'px';
  viewport.style.height = alturaEscalada + 'px';
  area.style.transform = 'scale(' + escala + ')';
  Estado.escalaAplicada = escala;
  Estado.escalaTelaAplicada = escalaTela;
  posicionarFlor();
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

  $('#meta-progresso-valor').textContent = meta.progresso + '/' + meta.dias + ' dias';
  $('#meta-progresso-prazo').textContent = 'Prazo: ' + formatarDataMeta(meta.prazo);
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
  item.concluido = novoProgresso >= meta.dias;
  await guardar();
  renderizarFlor();
}

async function concluirMetaAtual() {
  const item = Estado.itemPai;
  if (!item || !item.meta) return;
  const meta = normalizarMeta(item.meta);
  meta.progresso = meta.dias;
  item.meta = meta;
  item.concluido = true;
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
    guardar();
    renderizarFlor();
  });
}

function abrirEditorMeta(titulo, nome, dias, inicio, okTexto) {
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
  $('#meta-dias').addEventListener('input', atualizarPrevisao);
  $('#meta-inicio').addEventListener('input', atualizarPrevisao);

  return resultado.then(res => {
    if (res !== 'ok') return null;
    return {
      nome: ($('#meta-nome').value || '').trim(),
      dias: Math.floor(Number($('#meta-dias').value)),
      inicio: $('#meta-inicio').value || hoje,
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
  miolo.itens.push(item);
  await guardar();
  renderizarFlor();
  toast('Meta criada.');
}

async function editarMetaItem(item) {
  const meta = normalizarMeta(item.meta);
  if (!meta) return;
  const dados = await abrirEditorMeta('Editar meta', item.nome, meta.dias, meta.inicio, 'Salvar');
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
  item.nome = nome;
  item.miolo.nome = nome;
  item.meta = meta;
  item.concluido = meta.progresso >= meta.dias;
  await guardar();
  renderizarFlor();
  toast('Meta atualizada.');
}

async function transformarEmMeta(item) {
  const dados = await abrirEditorMeta('Transformar em meta', item.nome, 30, dataLocalISO(), 'Criar meta');
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
  item.concluido = false;
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
              item.concluido = false;
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
              item.concluido = true;
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
              item.concluido = false;
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
              item.concluido = true;
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

function renderizarAnexos() {
  const miolo = Estado.anexosDe;
  if (!miolo) { irParaLista(); return; }

  $('#anexos-titulo').innerHTML = '<b>' + escapeHtml(Estado.anexosTitulo) + '</b>';

  const container = $('#anexos-container');
  const vazio = $('#anexos-vazio');
  container.innerHTML = '';
  container.appendChild(vazio);
  vazio.style.display = miolo.anexos.length === 0 ? '' : 'none';

  const lista = [...miolo.anexos].sort((a, b) => (b.adicionado || '').localeCompare(a.adicionado || ''));

  lista.forEach(anexo => {
    const el = document.createElement('div');
    el.className = 'item-anexo';

    const etiqueta = document.createElement('span');
    etiqueta.className = 'etiqueta-anexo ' + anexo.tipo;
    etiqueta.textContent = rotuloAnexo(anexo.tipo);

    const dados = document.createElement('div');
    dados.className = 'dados-anexo';
    const nome = document.createElement('div');
    nome.className = 'nome';
    nome.textContent = anexo.nome || (ehLink(anexo.valor) ? anexo.valor : 'anexo');
    const valor = document.createElement('div');
    valor.className = 'valor';
    valor.textContent = anexo.valor || '';
    if (valor.textContent && valor.textContent !== nome.textContent) dados.appendChild(valor);
    const data = document.createElement('div');
    data.className = 'data';
    data.textContent = anexo.adicionado ? dataAmigavel(anexo.adicionado) : '';
    if (data.textContent) dados.appendChild(data);
    dados.insertBefore(nome, dados.firstChild);

    const remover = document.createElement('button');
    remover.className = 'botao-remover-anexo';
    remover.textContent = '\u00D7';
    remover.title = 'Remover';
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

    el.appendChild(etiqueta);
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
  if (!blob) { toast('Arquivo não encontrado.'); return; }
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

  canvasFlor.addEventListener('wheel', e => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    alterarZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, { x: e.clientX, y: e.clientY });
  }, { passive: false });

  canvasFlor.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const viewport = $('#flor-viewport');
    const temOverflow = viewport.offsetWidth > canvasFlor.clientWidth - 16 ||
      viewport.offsetHeight > canvasFlor.clientHeight - 16;
    if (!temOverflow) return;

    arrasto = {
      id: e.pointerId,
      inicioX: e.clientX,
      inicioY: e.clientY,
      panX: Estado.panX,
      panY: Estado.panY,
      ativo: false
    };
    Estado.arrastouFlor = false;
  });

  canvasFlor.addEventListener('pointermove', e => {
    if (!arrasto || arrasto.id !== e.pointerId) return;
    const dx = e.clientX - arrasto.inicioX;
    const dy = e.clientY - arrasto.inicioY;
    if (!arrasto.ativo && Math.hypot(dx, dy) < 12) return;

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
    if (!arrasto || (e && arrasto.id !== e.pointerId)) return;
    const id = arrasto.id;
    arrasto = null;
    canvasFlor.classList.remove('arrastando');
    try {
      if (canvasFlor.hasPointerCapture(id)) canvasFlor.releasePointerCapture(id);
    } catch (_) {}
    if (e && e.type === 'pointercancel') Estado.arrastouFlor = false;
  }

  canvasFlor.addEventListener('pointerup', finalizarArrasto);
  canvasFlor.addEventListener('pointercancel', finalizarArrasto);
  canvasFlor.addEventListener('lostpointercapture', finalizarArrasto);
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

  document.querySelectorAll('[data-anexo-tipo]').forEach(b => {
    b.addEventListener('click', () => fluxoAdicionarAnexo(b.dataset.anexoTipo));
  });

  $('#sheet-fechar').addEventListener('click', fecharSheet);
  $('#sheet-overlay').addEventListener('click', e => { if (e.target.id === 'sheet-overlay') fecharSheet(); });
  $('#modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') resolverModal(null); });
  $('#modal-ok').addEventListener('click', () => resolverModal('ok'));
  $('#modal-cancelar').addEventListener('click', () => resolverModal(null));

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#sheet-overlay').hidden) fecharSheet();
    else if (!$('#modal-overlay').hidden) resolverModal(null);
    else if (Estado.tela === 'flor') voltar();
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
    document.documentElement.dataset.ready = '1';
  } catch (err) {
    document.documentElement.dataset.initerr = String(err && err.message || err);
    mostrarErroTela(String(err && err.message || err));
  }
}

iniciar();