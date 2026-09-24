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
  anexosDe: null,     // miolo cujos anexos estão abertos
  anexosTitulo: '',
  tela: 'lista',
  ladoCanvas: 660,
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
  Estado.anexosDe = null;
  mostrarTela('lista');
  renderizarLista();
}

function abrirProjeto(projeto) {
  Estado.atual = projeto;
  Estado.caminho = [projeto.raiz];
  mostrarTela('projeto');
  renderizarProjeto();
}

function entrarItem(item) {
  if (!item.miolo) item.miolo = novoMiolo(item.nome);
  Estado.caminho.push(item.miolo);
  renderizarProjeto();
}

function voltar() {
  if (Estado.caminho.length > 1) {
    Estado.caminho.pop();
    renderizarProjeto();
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
        abrirProjeto(carregado);
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
 * CÍRCULOS
 * ============================================================ */

const TAM_ITEM = 118;
const TAM_CENTRO = 160;

function renderizarProjeto() {
  const miolo = mioloAtual();
  if (!miolo) return;

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

  const area = $('#projeto-area');
  area.innerHTML = '';

  const n = miolo.itens.length;
  const raioMin = TAM_CENTRO / 2 + TAM_ITEM / 2 + 26;
  let raio = n <= 2 ? raioMin + 14 : raioMin + n * 10;
  const lado = Math.max(400, Math.ceil((raio + TAM_ITEM / 2 + 46) * 2));
  const cx = lado / 2;
  const cy = lado / 2;
  Estado.ladoCanvas = lado;

  area.style.width = lado + 'px';
  area.style.height = lado + 'px';

  const pontos = [];

  /* centro */
  const centro = document.createElement('div');
  centro.className = 'centro';
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
  csub.textContent = nAnexos > 0
    ? 'toque p/ editar • ' + nAnexos + ' anexo(s)'
    : 'toque p/ editar';
  centro.appendChild(csub);

  centro.addEventListener('click', () => { Som.centro(); editarMiolo(); });
  centro.addEventListener('contextmenu', e => {
    e.preventDefault();
    mostrarSheet('Centro: ' + (miolo.nome || 'Sem nome'), [
      { texto: 'Editar centro', acao: () => editarMiolo() },
      { texto: 'Anexos do centro', acao: () => abrirAnexos(null) },
    ]);
  });
  area.appendChild(centro);

  /* itens em círculo */
  miolo.itens.forEach((item, i) => {
    const ang = (n === 1 ? -90 : -90 + i * 360 / n) * Math.PI / 180;
    const x = cx + raio * Math.cos(ang) - TAM_ITEM / 2;
    const y = cy + raio * Math.sin(ang) - TAM_ITEM / 2;
    pontos.push({ x: cx + raio * Math.cos(ang), y: cy + raio * Math.sin(ang) });

    const [ca, cb] = corDoItem(item.cor);
    const el = document.createElement('div');
    el.className = 'item';
    el.style.background = 'linear-gradient(135deg, ' + ca + ', ' + cb + ')';
    el.style.left = x + 'px';
    el.style.top = y + 'px';

    const nome = document.createElement('div');
    nome.className = 'nome-circulo';
    nome.textContent = item.nome || '...';
    el.appendChild(nome);

    const subItens = item.miolo ? item.miolo.itens.length : 0;
    const subAnexos = item.miolo ? item.miolo.anexos.length : 0;
    let subTxt = '';
    if (subItens > 0 && subAnexos > 0) subTxt = subItens + ' filho(s) • ' + subAnexos;
    else if (subAnexos > 0) subTxt = subAnexos + ' anexo(s)';
    else if (subItens > 0) subTxt = subItens + ' filho(s)';

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

  /* linhas ligando o centro aos círculos menores */
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'projeto-linhas';
  svg.setAttribute('width', lado);
  svg.setAttribute('height', lado);
  svg.setAttribute('viewBox', '0 0 ' + lado + ' ' + lado);
  svg.setAttribute('aria-hidden', 'true');
  pontos.forEach(p => {
    svg.appendChild(criarLinha(cx, cy, p.x, p.y));
  });
  area.insertBefore(svg, area.firstChild);

  aplicarEscala();
}

function criarLinha(x1, y1, x2, y2) {
  const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  l.setAttribute('x1', x1);
  l.setAttribute('y1', y1);
  l.setAttribute('x2', x2);
  l.setAttribute('y2', y2);
  l.setAttribute('stroke', '#8B93A7');
  l.setAttribute('stroke-opacity', '0.45');
  l.setAttribute('stroke-width', '2');
  l.setAttribute('stroke-linecap', 'round');
  return l;
}

function aplicarEscala() {
  const canvasEl = $('#projeto-canvas');
  const area = $('#projeto-area');
  const dispW = canvasEl.clientWidth - 16;
  const dispH = canvasEl.clientHeight - 16;
  let escala = dispW / Estado.ladoCanvas;
  if (dispH > 0) escala = Math.min(escala, dispH / Estado.ladoCanvas);
  area.style.transform = 'scale(' + Math.max(0.15, Math.min(3.5, escala)) + ')';
  area.style.transformOrigin = 'center center';
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
    renderizarProjeto();
  });
}

function mostrarOpcoesItem(item) {
  const nome = item.nome || '...';
  mostrarSheet('Item: ' + nome, [
    {
      texto: 'Editar item',
      acao: () => editar('Editar item', item.nome, item.anotacoes || '', (n, notas) => {
        item.nome = n;
        item.anotacoes = notas;
        guardar();
        renderizarProjeto();
      }),
    },
    { texto: 'Anexos', acao: () => abrirAnexos(item) },
    {
      texto: 'Apagar item',
      cor: 'danger',
      acao: () => confirmar('Apagar item', 'Apagar "' + nome + '" e tudo o que existe dentro dele?', () => {
        const miolo = mioloAtual();
        miolo.itens = miolo.itens.filter(i => i !== item);
        guardar();
        renderizarProjeto();
        toast('Item apagado.');
      }),
    },
  ]);
}

function novoItemFluxo() {
  prompt('Novo item', 'Nome do item:', 'Ex.: Banheiro', 'Banheiro', nome => {
    const miolo = mioloAtual();
    miolo.itens.push(novoItem(nome.trim(), miolo.itens.length));
    guardar();
    renderizarProjeto();
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
  prompt(titulo, 'Cole o endereço:', 'https://', 'https://', async texto => {
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
    b.className = 'sheet-opcao' + (op.cor === 'danger' ? ' danger' : '');
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
    prompt('Novo projeto', 'Dê um nome ao centro deste projeto:', 'Ex.: Reforma', 'Reforma', async nome => {
      const projeto = {
        id: novoId(),
        nome: nome.trim(),
        modificado: new Date().toISOString(),
        raiz: novoMiolo(nome.trim()),
      };
      await Storage.salvarProjeto(projeto);
      await recarregarProjetos();
      abrirProjeto(projeto);
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
    mostrarTela('projeto');
    renderizarProjeto();
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
    else if (Estado.tela === 'projeto') voltar();
  });

  window.addEventListener('resize', () => { if (Estado.tela === 'projeto') aplicarEscala(); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => { if (Estado.tela === 'projeto') aplicarEscala(); });
  }
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
    console.error('[Fractal]', err);
  }
}

iniciar();