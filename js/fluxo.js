'use strict';
document.documentElement.dataset.loadedfluxo = '1';

/* ============================================================
 * Fluxograma: editor de um item do tipo 'fluxo'.
 *
 * Na flor o fluxograma é um círculo como os outros. Ao entrar nele, esta
 * tela desenha o processo em SVG: símbolos usuais de fluxograma ligados por
 * setas. O modelo dos dados fica no storage.js.
 *
 * Como se usa:
 *  - o fluxo nasce com Início ligado ao Fim;
 *  - tocar num bloco o destaca; tocar de novo abre o menu dele;
 *  - o botão + abre a grade de símbolos; o escolhido entra abaixo do bloco
 *    destacado, ligado a ele;
 *  - a Decisão nasce com dois pontos soltos, "Sim" e "Não"; tocando num
 *    deles, o + continua aquele caminho ou o liga ao Fim;
 *  - o Fim fica sempre embaixo de tudo;
 *  - Desfazer e Refazer voltam e avançam nas mudanças do fluxo.
 * Arrastar um bloco: move (com grade). Arrastar o fundo: desloca a vista.
 * Pinça ou roda do mouse: zoom. Toque numa seta: rótulo, inverter, apagar.
 *
 * O desenho usa atributos de cor (e não classes do CSS) para que o mesmo
 * SVG vire imagem PNG sem depender da folha de estilo.
 * ============================================================ */

const Fluxo = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const GRADE = 10;
  const DISTANCIA = 64;      // espaço vertical entre um bloco e o próximo
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 3;
  const LIMITE_HISTORICO = 60;

  const MEDIDAS = {
    inicio: { l: 136, a: 50 },
    fim: { l: 136, a: 50 },
    etapa: { l: 172, a: 66 },
    decisao: { l: 184, a: 100 },
    dados: { l: 180, a: 66 },
    documento: { l: 172, a: 72 },
    subprocesso: { l: 180, a: 66 },
    espera: { l: 168, a: 62 },
    caso: { l: 84, a: 34 },
  };
  const NOME_FORMA = {
    inicio: 'Início', etapa: 'Etapa', decisao: 'Decisão', dados: 'Dados', documento: 'Documento',
    subprocesso: 'Subprocesso', espera: 'Espera', fim: 'Fim', caso: 'Caso',
  };

  /* Grade do botão +: os símbolos mais usados em fluxogramas. */
  const SIMBOLOS = [
    { forma: 'etapa', nome: 'Etapa', uso: 'Processo, uma ação' },
    { forma: 'decisao', nome: 'Decisão', uso: 'Pergunta com Sim e Não' },
    { forma: 'dados', nome: 'Dados', uso: 'Entrada ou saída' },
    { forma: 'documento', nome: 'Documento', uso: 'Papel, relatório' },
    { forma: 'subprocesso', nome: 'Subprocesso', uso: 'Processo já definido' },
    { forma: 'espera', nome: 'Espera', uso: 'Aguardar, prazo' },
    { forma: 'fim', nome: 'Fim', uso: 'Termina o caminho' },
  ];
  const ICONES = {
    etapa: '<rect class="forma" x="2" y="3" width="32" height="16" rx="3"/>',
    decisao: '<polygon class="forma" points="18,1 34,11 18,21 2,11"/>',
    dados: '<polygon class="forma" points="8,3 34,3 28,19 2,19"/>',
    documento: '<path class="forma" d="M2 3h32v13q-8 5-16 0t-16 0z"/>',
    subprocesso: '<rect class="forma" x="2" y="3" width="32" height="16" rx="2"/><path class="linha" d="M7 3v16M29 3v16"/>',
    espera: '<path class="forma" d="M2 3h24a8 8 0 0 1 0 16H2z"/>',
    fim: '<rect class="cheio" x="2" y="4" width="32" height="14" rx="7"/>',
    ligarFim: '<path class="linha" d="M3 11h17m-5-5l5 5-5 5"/><rect class="cheio" x="23" y="6" width="12" height="10" rx="5"/>',
    ligar: '<circle class="forma" cx="6" cy="11" r="4"/><circle class="forma" cx="30" cy="11" r="4"/><path class="linha" d="M10 11h12m-4-4l4 4-4 4"/>',
  };

  /* Mesma paleta do app (styles.css): fundo escuro e o dourado da marca. */
  const COR = {
    ouro: '#FFD86B',
    laranja: '#F5850C',
    cartao: '#151B2E',
    fundo: '#0B1020',
    borda: '#2A3350',
    texto: '#E6EDF3',
    fraco: '#8B98A8',
    escuro: '#141A26',
    verde: '#2DA44E',
    verdeClaro: '#6EE7B7',
    linha: '#C9A64F',
  };
  const FONTE = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  const E = {
    item: null,        // item do tipo fluxo aberto
    sel: null,         // id do bloco destacado
    ligandoDe: null,   // id do bloco de origem enquanto escolhe o destino
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  // Histórico do fluxo aberto: fotografias (JSON) antes de cada mudança.
  const H = { desfazer: [], refazer: [] };

  const $id = id => document.getElementById(id);

  function fluxo() {
    if (!E.item.fluxo) E.item.fluxo = novoFluxo();
    return E.item.fluxo;
  }

  function bloco(id) {
    return id ? fluxo().blocos.find(b => b.id === id) || null : null;
  }

  function nomeBloco(b) {
    return (b && (b.texto || NOME_FORMA[b.forma])) || 'Bloco';
  }

  /* "Etapa: Conferir pedido", ou só "Início" quando o texto é o da forma. */
  function tituloBloco(b) {
    const forma = NOME_FORMA[b.forma];
    return b.texto && b.texto !== forma ? forma + ': ' + b.texto : forma;
  }

  const ehTrabalho = b => FORMAS_TRABALHO.includes(b.forma);
  const pilula = b => b.forma === 'inicio' || b.forma === 'fim';

  function el(nome, atributos, filhos) {
    const n = document.createElementNS(NS, nome);
    Object.keys(atributos || {}).forEach(k => {
      if (atributos[k] !== null && atributos[k] !== undefined) n.setAttribute(k, atributos[k]);
    });
    (filhos || []).forEach(f => f && n.appendChild(f));
    return n;
  }

  function texto(conteudo, atributos) {
    const t = el('text', Object.assign({ 'font-family': FONTE, 'text-anchor': 'middle' }, atributos));
    t.textContent = conteudo;
    return t;
  }

  const arredondar = v => Math.round(v / GRADE) * GRADE;

  /* ---------------- abrir / sair ---------------- */

  function abrir(item) {
    E.item = item;
    E.sel = null;
    E.ligandoDe = null;
    H.desfazer = [];
    H.refazer = [];
    fluxo();
    mostrarTela('fluxo');
    renderizarTitulo();
    render();
    centralizar();
  }

  function sair() {
    E.item = null;
    E.sel = null;
    E.ligandoDe = null;
    H.desfazer = [];
    H.refazer = [];
    mostrarTela('flor');
    renderizarFlor();
  }

  /* Botão voltar (celular e tela). Devolve true: sempre tratado aqui. */
  function voltar() {
    if (E.ligandoDe) {
      E.ligandoDe = null;
      render();
      return true;
    }
    sair();
    return true;
  }

  /* Volta da tela de anexos de um bloco. Os anexos mudam fora do histórico,
   * então ele recomeça: desfazer depois disso perderia o anexo novo. */
  function reabrir() {
    if (!E.item) { sair(); return; }
    H.desfazer = [];
    H.refazer = [];
    mostrarTela('fluxo');
    render();
  }

  function renderizarTitulo() {
    const titulo = $id('fluxo-titulo');
    titulo.innerHTML = '';
    const nomes = Estado.caminho.map(m => m.nome || 'Sem nome').concat(E.item.nome || 'Fluxograma');
    nomes.forEach((nome, i) => {
      if (i > 0) {
        const s = document.createElement('span');
        s.textContent = ' › ';
        titulo.appendChild(s);
      }
      const b = document.createElement('b');
      b.textContent = nome;
      titulo.appendChild(b);
    });
  }

  /* ---------------- desfazer / refazer ---------------- */

  function fotografia() {
    return JSON.stringify(fluxo());
  }

  /* Chamado antes de cada mudança no fluxo. */
  function registrar() {
    H.desfazer.push(fotografia());
    if (H.desfazer.length > LIMITE_HISTORICO) H.desfazer.shift();
    H.refazer = [];
  }

  function voltarPara(origem, destino, aviso) {
    if (!origem.length) return;
    destino.push(fotografia());
    E.item.fluxo = JSON.parse(origem.pop());
    if (!bloco(E.sel)) E.sel = null;
    E.ligandoDe = null;
    salvar();
    toast(aviso);
  }

  const desfazer = () => voltarPara(H.desfazer, H.refazer, 'Desfeito.');
  const refazer = () => voltarPara(H.refazer, H.desfazer, 'Refeito.');

  function atualizarBotoes() {
    $id('fluxo-desfazer').disabled = !H.desfazer.length;
    $id('fluxo-refazer').disabled = !H.refazer.length;
    const aviso = $id('fluxo-aviso');
    aviso.hidden = !E.ligandoDe;
    if (E.ligandoDe) aviso.textContent = 'Toque no bloco que vem depois de "' + nomeBloco(bloco(E.ligandoDe)) + '". Toque no fundo para cancelar.';
  }

  /* ---------------- desenho ---------------- */

  /* Quebra o texto em linhas de até `max` caracteres; corta com reticências. */
  function quebrar(conteudo, max, maxLinhas) {
    const palavras = String(conteudo || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const linhas = [];
    let atual = '';
    palavras.forEach(palavra => {
      let p = palavra;
      // Palavra maior que a linha: corta em pedaços.
      while (p.length > max) {
        if (atual) { linhas.push(atual); atual = ''; }
        linhas.push(p.slice(0, max));
        p = p.slice(max);
      }
      if (!p) return;
      const tentativa = atual ? atual + ' ' + p : p;
      if (tentativa.length <= max) atual = tentativa;
      else { linhas.push(atual); atual = p; }
    });
    if (atual) linhas.push(atual);
    if (linhas.length <= maxLinhas) return linhas;
    const saida = linhas.slice(0, maxLinhas);
    const ultima = saida[maxLinhas - 1];
    saida[maxLinhas - 1] = (ultima.length >= max ? ultima.slice(0, max - 1) : ultima) + '…';
    return saida;
  }

  /* O contorno de cada símbolo, centrado em (0, 0). */
  function forma(b, atributos) {
    const m = MEDIDAS[b.forma];
    const hw = m.l / 2;
    const hh = m.a / 2;
    const a = Object.assign({ 'stroke-linejoin': 'round' }, atributos);
    switch (b.forma) {
      case 'decisao':
        return el('polygon', Object.assign({ points: '0,' + (-hh) + ' ' + hw + ',0 0,' + hh + ' ' + (-hw) + ',0' }, a));
      case 'dados': {
        const s = 16;
        return el('polygon', Object.assign({
          points: (-hw + s) + ',' + (-hh) + ' ' + hw + ',' + (-hh) + ' ' + (hw - s) + ',' + hh + ' ' + (-hw) + ',' + hh,
        }, a));
      }
      case 'documento':
        return el('path', Object.assign({
          d: 'M' + (-hw) + ' ' + (-hh) + 'H' + hw + 'V' + (hh - 8) +
            'Q' + (hw / 2) + ' ' + (hh + 6) + ' 0 ' + (hh - 6) + 'T' + (-hw) + ' ' + (hh - 6) + 'Z',
        }, a));
      case 'subprocesso':
        // As duas barras laterais são o que diferencia o subprocesso.
        return el('g', a, [
          el('rect', { x: -hw, y: -hh, width: m.l, height: m.a, rx: 6 }),
          el('path', { d: 'M' + (-hw + 12) + ' ' + (-hh) + 'V' + hh + 'M' + (hw - 12) + ' ' + (-hh) + 'V' + hh, fill: 'none' }),
        ]);
      case 'espera':
        return el('path', Object.assign({
          d: 'M' + (-hw) + ' ' + (-hh) + 'H' + (hw - hh) + 'A' + hh + ' ' + hh + ' 0 0 1 ' + (hw - hh) + ' ' + hh + 'H' + (-hw) + 'Z',
        }, a));
      default:
        return el('rect', Object.assign({
          x: -hw, y: -hh, width: m.l, height: m.a, rx: pilula(b) || b.forma === 'caso' ? hh : 12,
        }, a));
    }
  }

  function desenharBloco(b, estado) {
    const m = MEDIDAS[b.forma];
    const caso = b.forma === 'caso';
    const feito = b.concluido === true;
    const selecionado = estado.sel === b.id;
    const origem = estado.ligandoDe === b.id;
    const g = el('g', { 'data-bloco': b.id, class: 'fluxo-bloco', transform: 'translate(' + b.x + ' ' + b.y + ')' });

    if (selecionado || origem) {
      g.appendChild(forma(b, {
        fill: 'none', stroke: COR.laranja, 'stroke-width': 10, 'stroke-opacity': origem ? 0.55 : 0.4,
      }));
    }

    const preenchimento = pilula(b) ? (feito ? COR.verde : COR.ouro) : caso ? COR.fundo : COR.cartao;
    g.appendChild(forma(b, {
      fill: preenchimento,
      stroke: feito ? COR.verde : (pilula(b) ? COR.laranja : COR.ouro),
      'stroke-width': selecionado ? 2.6 : 1.8,
    }));

    /* texto principal + responsável (linha menor) */
    const corTexto = pilula(b) ? COR.escuro : caso ? COR.ouro : (feito ? COR.verdeClaro : COR.texto);
    const responsavel = ehTrabalho(b) && b.responsavel ? b.responsavel : '';
    const porLinha = caso ? 10 : b.forma === 'decisao' ? 15 : pilula(b) ? 14 : b.forma === 'etapa' ? 19 : 17;
    const maxLinhas = caso ? 1 : b.forma === 'decisao' || pilula(b) ? 2 : (responsavel ? 2 : 3);
    const linhas = quebrar(nomeBloco(b), porLinha, maxLinhas);
    const altura = 16;
    const total = linhas.length + (responsavel ? 1 : 0);
    // O documento tem a base ondulada: o texto sobe um pouco.
    let y = -((total - 1) * altura) / 2 - (b.forma === 'documento' ? 4 : 0);
    linhas.forEach(linha => {
      const t = texto(linha, {
        x: 0, y, 'dominant-baseline': 'central', 'font-size': 13, 'font-weight': caso ? 700 : 600, fill: corTexto,
      });
      if (feito && !pilula(b)) t.setAttribute('text-decoration', 'line-through');
      g.appendChild(t);
      y += altura;
    });
    if (responsavel) {
      g.appendChild(texto(quebrar(responsavel, porLinha, 1)[0], {
        x: 0, y, 'dominant-baseline': 'central', 'font-size': 11, fill: COR.fraco,
      }));
    }
    if (caso) return g;

    /* selos: concluído (esquerda), anexos e notas (direita) */
    const topo = b.forma === 'decisao' ? -m.a / 4 - 6 : -m.a / 2;
    const esquerda = b.forma === 'decisao' ? -m.l / 4 - 4 : -m.l / 2;
    const direita = b.forma === 'decisao' ? m.l / 4 + 4 : m.l / 2;
    if (feito) {
      g.appendChild(el('circle', { cx: esquerda + 4, cy: topo + 4, r: 10, fill: '#16A34A', stroke: COR.fundo, 'stroke-width': 2.5 }));
      g.appendChild(texto('✓', {
        x: esquerda + 4, y: topo + 4, 'dominant-baseline': 'central', 'font-size': 12, 'font-weight': 800, fill: '#FFFFFF',
      }));
    }
    const selos = [];
    const nAnexos = (b.anexos || []).length;
    if (nAnexos) selos.push('\u{1F4CE}' + nAnexos);
    if (b.notas) selos.push('✎');
    if (selos.length) {
      const conteudo = selos.join(' ');
      const largura = 12 + conteudo.length * 6.5;
      g.appendChild(el('rect', {
        x: direita - largura + 6, y: topo - 6, width: largura, height: 20, rx: 10,
        fill: COR.fundo, stroke: COR.borda, 'stroke-width': 1,
      }));
      g.appendChild(texto(conteudo, {
        x: direita - largura / 2 + 6, y: topo + 4, 'dominant-baseline': 'central', 'font-size': 11, fill: COR.ouro,
      }));
    }
    return g;
  }

  /* Ponto da borda do bloco na direção de (alvoX, alvoY). */
  function pontoBorda(b, alvoX, alvoY) {
    const m = MEDIDAS[b.forma];
    const dx = alvoX - b.x;
    const dy = alvoY - b.y;
    if (!dx && !dy) return { x: b.x, y: b.y };
    const hw = m.l / 2;
    const hh = m.a / 2;
    const t = b.forma === 'decisao'
      ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
      : 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
    return { x: b.x + dx * t, y: b.y + dy * t };
  }

  function desenharLigacao(l, f, estado) {
    const de = f.blocos.find(b => b.id === l.de);
    const para = f.blocos.find(b => b.id === l.para);
    if (!de || !para) return null;

    /* Ida e volta entre os mesmos blocos: afasta as duas setas. */
    const temVolta = f.ligacoes.some(o => o.de === l.para && o.para === l.de);
    let ox = 0, oy = 0;
    if (temVolta) {
      const d = Math.hypot(para.x - de.x, para.y - de.y) || 1;
      ox = -(para.y - de.y) / d * 9;
      oy = (para.x - de.x) / d * 9;
    }
    const a = pontoBorda(de, para.x + ox, para.y + oy);
    const b = pontoBorda(para, de.x + ox, de.y + oy);
    const x1 = a.x + ox, y1 = a.y + oy;
    let x2 = b.x + ox, y2 = b.y + oy;
    const comp = Math.hypot(x2 - x1, y2 - y1);
    if (comp > 6) { x2 -= (x2 - x1) / comp * 3; y2 -= (y2 - y1) / comp * 3; }

    const g = el('g', { 'data-ligacao': l.id, class: 'fluxo-ligacao' });
    const destaque = estado.sel && (estado.sel === l.de || estado.sel === l.para);
    if (estado.interativo) {
      g.appendChild(el('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': 22 }));
    }
    g.appendChild(el('line', {
      x1, y1, x2, y2,
      stroke: destaque ? COR.ouro : COR.linha,
      'stroke-width': destaque ? 2.4 : 1.8,
      'marker-end': destaque ? 'url(#fluxo-seta-forte)' : 'url(#fluxo-seta)',
    }));
    if (l.rotulo) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const largura = 14 + l.rotulo.length * 7;
      g.appendChild(el('rect', {
        x: mx - largura / 2, y: my - 11, width: largura, height: 22, rx: 11,
        fill: COR.fundo, stroke: COR.linha, 'stroke-width': 1,
      }));
      g.appendChild(texto(l.rotulo, {
        x: mx, y: my, 'dominant-baseline': 'central', 'font-size': 12, 'font-weight': 600, fill: COR.ouro,
      }));
    }
    return g;
  }

  function marcadores() {
    // markerUnits em userSpaceOnUse: a ponta não cresce com a espessura.
    const seta = (id, cor) => el('marker', {
      id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 12, markerHeight: 12,
      orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse',
    }, [el('path', { d: 'M0 0L10 5L0 10z', fill: cor })]);
    return el('defs', {}, [seta('fluxo-seta', COR.linha), seta('fluxo-seta-forte', COR.ouro)]);
  }

  /* Monta o conteúdo (setas embaixo, blocos em cima) para a tela ou o PNG. */
  function montarDesenho(f, estado) {
    const g = el('g');
    const setas = el('g');
    f.ligacoes.forEach(l => { const s = desenharLigacao(l, f, estado); if (s) setas.appendChild(s); });
    const blocos = el('g');
    f.blocos.forEach(b => blocos.appendChild(desenharBloco(b, estado)));
    g.appendChild(setas);
    g.appendChild(blocos);
    return g;
  }

  function render() {
    if (!E.item) return;
    const svg = $id('fluxo-svg');
    const mundo = el('g', { id: 'fluxo-mundo' });
    mundo.appendChild(montarDesenho(fluxo(), { sel: E.sel, ligandoDe: E.ligandoDe, interativo: true }));
    svg.replaceChildren(marcadores(), mundo);
    aplicarVista();
    atualizarBotoes();
  }

  function aplicarVista() {
    const mundo = $id('fluxo-mundo');
    if (mundo) mundo.setAttribute('transform', 'translate(' + E.panX + ' ' + E.panY + ') scale(' + E.zoom + ')');
    // A grade de pontos do fundo acompanha o deslocamento e o zoom.
    const canvas = $id('fluxo-canvas');
    const passo = 20 * E.zoom;
    canvas.style.backgroundSize = passo + 'px ' + passo + 'px';
    canvas.style.backgroundPosition = E.panX + 'px ' + E.panY + 'px';
  }

  function limites(f) {
    if (!f.blocos.length) return { minX: -100, minY: -60, maxX: 100, maxY: 60 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    f.blocos.forEach(b => {
      const m = MEDIDAS[b.forma];
      minX = Math.min(minX, b.x - m.l / 2 - 12);
      maxX = Math.max(maxX, b.x + m.l / 2 + 12);
      minY = Math.min(minY, b.y - m.a / 2 - 12);
      maxY = Math.max(maxY, b.y + m.a / 2 + 12);
    });
    return { minX, minY, maxX, maxY };
  }

  /* Enquadra o fluxo inteiro na tela (deixando livre o canto do botão +). */
  function centralizar() {
    const canvas = $id('fluxo-canvas');
    const w = canvas.clientWidth || 360;
    const h = canvas.clientHeight || 480;
    const lim = limites(fluxo());
    const lw = lim.maxX - lim.minX;
    const lh = lim.maxY - lim.minY;
    const margem = 32;
    const rodape = 72;
    E.zoom = Math.max(ZOOM_MIN, Math.min(1.2, (w - margem * 2) / lw, (h - margem * 2 - rodape) / lh));
    E.panX = w / 2 - (lim.minX + lw / 2) * E.zoom;
    E.panY = (h - rodape) / 2 - (lim.minY + lh / 2) * E.zoom;
    aplicarVista();
  }

  function zoomEm(novo, clienteX, clienteY) {
    const r = $id('fluxo-canvas').getBoundingClientRect();
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, novo));
    const mx = (clienteX - r.left - E.panX) / E.zoom;
    const my = (clienteY - r.top - E.panY) / E.zoom;
    E.zoom = z;
    E.panX = clienteX - r.left - mx * z;
    E.panY = clienteY - r.top - my * z;
    aplicarVista();
  }

  /* ---------------- edição ---------------- */

  function salvar() {
    render();
    return guardar();
  }

  /* O Fim não conta: ele desce sozinho depois (manterFimEmbaixo). */
  function sobrepoe(x, y, formaNova) {
    const m = MEDIDAS[formaNova];
    return fluxo().blocos.some(b => {
      if (b.forma === 'fim') return false;
      const o = MEDIDAS[b.forma];
      return Math.abs(b.x - x) < (m.l + o.l) / 2 + 16 && Math.abs(b.y - y) < (m.a + o.a) / 2 + 16;
    });
  }

  /* Logo abaixo da origem; se já houver bloco ali, vai para o lado,
   * alternando direita e esquerda. */
  function posicaoAbaixo(formaNova, origem) {
    let x = arredondar(origem.x);
    let y = arredondar(origem.y + MEDIDAS[origem.forma].a / 2 + DISTANCIA + MEDIDAS[formaNova].a / 2);
    const passo = MEDIDAS[formaNova].l + 40;
    for (let i = 1; i <= 12 && sobrepoe(x, y, formaNova); i++) {
      const lado = i % 2 ? 1 : -1;
      const nx = arredondar(x + lado * Math.ceil(i / 2) * passo);
      if (!sobrepoe(nx, y, formaNova)) { x = nx; break; }
      if (i === 12) y += MEDIDAS[formaNova].a + 40;
    }
    return { x, y };
  }

  /* Espaço que o bloco ocupa abaixo do centro: a decisão leva junto os
   * pontos Sim e Não. */
  function alturaAbaixo(formaNova) {
    const m = MEDIDAS[formaNova];
    return formaNova === 'decisao' ? m.a / 2 + 40 + MEDIDAS.caso.a : m.a / 2;
  }

  /* Desce um bloco e tudo o que vem depois dele seguindo as setas, para
   * abrir espaço. Só desce o caminho que cresceu: o outro lado de uma
   * decisão fica onde está. Blocos acima de limiteY não se mexem (assim uma
   * seta que volta para trás, num laço, não arrasta o começo do fluxo). */
  function descerDaqui(inicio, quanto, limiteY) {
    if (!inicio || quanto <= 0) return;
    const f = fluxo();
    const mover = new Set();
    const fila = [inicio.id];
    while (fila.length) {
      const id = fila.shift();
      const b = bloco(id);
      if (mover.has(id) || !b || b.y <= limiteY) continue;
      mover.add(id);
      f.ligacoes.forEach(l => { if (l.de === id) fila.push(l.para); });
    }
    f.blocos.forEach(b => { if (mover.has(b.id)) b.y = arredondar(b.y + quanto); });
  }

  /* O Fim fica sempre embaixo de tudo, para as setas descerem até ele. */
  function manterFimEmbaixo() {
    const f = fluxo();
    let fundo = -Infinity;
    f.blocos.forEach(b => {
      if (b.forma !== 'fim') fundo = Math.max(fundo, b.y + MEDIDAS[b.forma].a / 2);
    });
    if (fundo === -Infinity) return;
    f.blocos.forEach(b => {
      if (b.forma !== 'fim') return;
      const minimo = fundo + DISTANCIA + MEDIDAS.fim.a / 2;
      if (b.y < minimo) b.y = arredondar(minimo);
    });
  }

  /* Dois pontos soltos abaixo da decisão: "Sim" à esquerda, "Não" à direita. */
  function criarCasos(decisao) {
    const f = fluxo();
    const y = arredondar(decisao.y + MEDIDAS.decisao.a / 2 + 40 + MEDIDAS.caso.a / 2);
    [['Sim', -110], ['Não', 110]].forEach(([nome, dx]) => {
      const caso = novoBloco('caso', nome, arredondar(decisao.x + dx), y);
      f.blocos.push(caso);
      f.ligacoes.push({ id: novoId(), de: decisao.id, para: caso.id, rotulo: '' });
    });
  }

  /* Põe o bloco novo abaixo do anterior, no meio da seta l (anterior ->
   * seguinte). O seguinte e o que vem depois dele descem. Numa etapa e afins
   * o caminho continua: anterior -> novo -> seguinte. Numa decisão o caminho
   * para nela (os pontos Sim e Não ficam soltos) e o seguinte fica solto
   * mais abaixo, para o usuário ligar onde quiser. */
  function inserirNaSeta(l, formaNova) {
    const f = fluxo();
    const anterior = bloco(l.de);
    const seguinte = bloco(l.para);
    const y = arredondar(anterior.y + MEDIDAS[anterior.forma].a / 2 + DISTANCIA + MEDIDAS[formaNova].a / 2);
    const minimo = y + alturaAbaixo(formaNova) + DISTANCIA + MEDIDAS[seguinte.forma].a / 2;
    descerDaqui(seguinte, arredondar(minimo - seguinte.y), anterior.y);
    const novo = novoBloco(formaNova, '', anterior.x, y);
    f.blocos.push(novo);
    l.para = novo.id;
    if (formaNova !== 'decisao') f.ligacoes.push({ id: novoId(), de: novo.id, para: seguinte.id, rotulo: '' });
    return novo;
  }

  function abaixoDe(anterior, formaNova) {
    const pos = posicaoAbaixo(formaNova, anterior);
    const novo = novoBloco(formaNova, formaNova === 'fim' ? 'Fim' : '', pos.x, pos.y);
    fluxo().blocos.push(novo);
    fluxo().ligacoes.push({ id: novoId(), de: anterior.id, para: novo.id, rotulo: '' });
    return novo;
  }

  /* Por que o + não pode acrescentar depois deste bloco (ou '' se pode). */
  function motivoBloqueio(sel) {
    if (!sel) return 'Toque primeiro no bloco que vem antes.';
    if (sel.forma === 'fim') return 'Depois do Fim não entra nada. Toque no bloco que vem antes dele.';
    const saidas = fluxo().ligacoes.filter(l => l.de === sel.id).length;
    if (sel.forma === 'decisao' && saidas) return 'Toque no "Sim" ou no "Não" para continuar aquele caminho.';
    return '';
  }

  /* Acrescenta um símbolo abaixo do bloco destacado, ligado a ele. */
  function adicionar(formaNova) {
    const anterior = bloco(E.sel);
    const motivo = motivoBloqueio(anterior);
    if (motivo) { toast(motivo); return; }
    registrar();
    const saidas = fluxo().ligacoes.filter(l => l.de === anterior.id);
    // Com uma saída só, o bloco entra no meio dela; senão abre caminho novo.
    // Um Fim novo nunca entra no meio: ele termina o caminho do anterior.
    const novo = saidas.length === 1 && formaNova !== 'fim'
      ? inserirNaSeta(saidas[0], formaNova)
      : abaixoDe(anterior, formaNova);
    if (formaNova === 'decisao') criarCasos(novo);
    manterFimEmbaixo();
    E.sel = novo.id;
    E.ligandoDe = null;
    salvar();
    garantirVisivel(novo);
    if (formaNova === 'fim') return;
    const pergunta = formaNova === 'decisao' ? 'Pergunta da decisão:' : 'O que acontece neste bloco?';
    const exemplo = formaNova === 'decisao' ? 'Ex.: Tem estoque?' : formaNova === 'dados' ? 'Ex.: Receber o pedido'
      : formaNova === 'documento' ? 'Ex.: Emitir nota fiscal' : formaNova === 'espera' ? 'Ex.: Aguardar 2 dias' : 'Ex.: Conferir o pedido';
    prompt('Novo bloco: ' + NOME_FORMA[formaNova], pergunta, exemplo, '', valor => {
      novo.texto = valor;
      salvar();
    });
  }

  /* Liga o bloco destacado ao Fim (o mais usado para fechar um caminho). */
  function ligarAoFim(sel) {
    const fim = fluxo().blocos.find(b => b.forma === 'fim');
    if (!fim) { toast('Não há bloco Fim. Use o + para criar um.'); return; }
    if (fluxo().ligacoes.some(l => l.de === sel.id && l.para === fim.id)) {
      toast('Este bloco já está ligado ao Fim.');
      return;
    }
    registrar();
    fluxo().ligacoes.push({ id: novoId(), de: sel.id, para: fim.id, rotulo: '' });
    manterFimEmbaixo();
    salvar();
    toast('Ligado ao Fim.');
  }

  function comecarLigacao(b) {
    E.ligandoDe = b.id;
    render();
  }

  /* Grade do botão +: os símbolos e, embaixo, as ligações. */
  function abrirSimbolos() {
    if (E.ligandoDe) { E.ligandoDe = null; render(); }
    const sel = bloco(E.sel);
    const motivo = motivoBloqueio(sel);
    if (motivo) { toast(motivo); return; }

    const grade = document.createElement('div');
    grade.className = 'fluxo-simbolos';
    const botao = (icone, nome, uso, acao) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fluxo-ferramenta';
      b.innerHTML = '<svg viewBox="0 0 36 22" aria-hidden="true">' + ICONES[icone] + '</svg>';
      const n = document.createElement('span');
      n.textContent = nome;
      const u = document.createElement('small');
      u.textContent = uso;
      b.append(n, u);
      b.addEventListener('click', () => { fecharSheet(); acao(); });
      return b;
    };
    SIMBOLOS.forEach(s => grade.appendChild(botao(s.forma, s.nome, s.uso, () => adicionar(s.forma))));

    const ligacoes = document.createElement('div');
    ligacoes.className = 'fluxo-simbolos fluxo-simbolos-ligar';
    const fim = fluxo().blocos.find(b => b.forma === 'fim');
    if (fim && !fluxo().ligacoes.some(l => l.de === sel.id && l.para === fim.id)) {
      ligacoes.appendChild(botao('ligarFim', 'Ligar ao Fim', 'Fecha este caminho', () => ligarAoFim(sel)));
    }
    ligacoes.appendChild(botao('ligar', 'Ligar a outro', 'Depois toque no destino', () => comecarLigacao(sel)));

    $id('sheet-titulo').textContent = 'Depois de "' + nomeBloco(sel) + '"';
    $id('sheet-opcoes').replaceChildren(grade, ligacoes);
    $id('sheet-overlay').hidden = false;
  }

  /* Desloca a vista se o bloco novo nasceu fora da tela. */
  function garantirVisivel(b) {
    const canvas = $id('fluxo-canvas');
    const w = canvas.clientWidth;
    const h = canvas.clientHeight - 72;   // o botão + ocupa o rodapé
    const m = MEDIDAS[b.forma];
    const sx = b.x * E.zoom + E.panX;
    const sy = b.y * E.zoom + E.panY;
    const folga = 24;
    const meiaL = m.l / 2 * E.zoom + folga;
    const meiaA = m.a / 2 * E.zoom + folga + (b.forma === 'decisao' ? (40 + MEDIDAS.caso.a) * E.zoom : 0);
    if (sx - meiaL < 0) E.panX += meiaL - sx;
    if (sx + meiaL > w) E.panX -= sx + meiaL - w;
    if (sy - meiaA < 0) E.panY += meiaA - sy;
    if (sy + meiaA > h) E.panY -= sy + meiaA - h;
    aplicarVista();
  }

  function editarBloco(b) {
    if (b.forma === 'caso') {
      prompt('Ponto da decisão', 'Resposta (ex.: Sim, Não, Talvez):', 'Ex.: Talvez', b.texto || '', valor => {
        registrar();
        b.texto = valor.slice(0, 20);
        salvar();
      });
      return;
    }
    const opcoes = FORMAS_FLUXO.filter(f => f !== 'caso').map(f =>
      '<option value="' + f + '"' + (f === b.forma ? ' selected' : '') + '>' + NOME_FORMA[f] + '</option>').join('');
    abrirModal(tituloBloco(b),
      '<label for="fb-texto">Texto</label>' +
      '<input class="campo" id="fb-texto" type="text" value="' + escapeHtml(b.texto || '') + '">' +
      '<label for="fb-forma">Símbolo</label>' +
      '<select class="campo" id="fb-forma">' + opcoes + '</select>' +
      '<label for="fb-responsavel">Responsável</label>' +
      '<input class="campo" id="fb-responsavel" type="text" placeholder="Quem executa esta etapa" value="' + escapeHtml(b.responsavel || '') + '">' +
      '<label for="fb-notas">Notas</label>' +
      '<textarea class="campo" id="fb-notas" placeholder="Detalhes, regras, observações">' + escapeHtml(b.notas || '') + '</textarea>' +
      '<label class="fluxo-check"><input type="checkbox" id="fb-concluido"' + (b.concluido ? ' checked' : '') + '> Etapa concluída</label>',
      'Salvar'
    ).then(res => {
      if (res !== 'ok') return;
      registrar();
      b.texto = ($id('fb-texto').value || '').trim();
      const formaNova = $id('fb-forma').value;
      if (FORMAS_FLUXO.includes(formaNova)) b.forma = formaNova;
      b.responsavel = ($id('fb-responsavel').value || '').trim();
      b.notas = ($id('fb-notas').value || '').trim();
      const concluido = $id('fb-concluido').checked;
      if (concluido && !b.concluido) Som.centro();
      b.concluido = concluido;
      salvar();
    });
  }

  function alternarConcluido(b) {
    registrar();
    b.concluido = !b.concluido;
    if (b.concluido) Som.centro();
    salvar();
    toast(b.concluido ? 'Etapa concluída.' : 'Etapa reaberta.');
  }

  /* Os arquivos dos anexos ficam guardados: o Desfazer pode trazer o bloco
   * de volta, e com ele os anexos. */
  function apagarBloco(b) {
    confirmar('Apagar bloco', 'Apagar "' + nomeBloco(b) + '" e as setas dele?', () => {
      registrar();
      const f = fluxo();
      const ids = new Set([b.id]);
      // Uma decisão leva junto os pontos Sim/Não que só saem dela.
      if (b.forma === 'decisao') {
        f.ligacoes.filter(l => l.de === b.id).forEach(l => {
          const p = bloco(l.para);
          if (p && p.forma === 'caso' && f.ligacoes.filter(o => o.para === p.id).length === 1) ids.add(p.id);
        });
      }
      f.blocos = f.blocos.filter(x => !ids.has(x.id));
      f.ligacoes = f.ligacoes.filter(l => !ids.has(l.de) && !ids.has(l.para));
      if (ids.has(E.sel)) E.sel = null;
      if (ids.has(E.ligandoDe)) E.ligandoDe = null;
      salvar();
      toast('Bloco apagado. Use Desfazer se foi sem querer.');
    });
  }

  function abrirAnexosBloco(b) {
    if (!Array.isArray(b.anexos)) b.anexos = [];
    Estado.anexosDe = b;
    Estado.anexosTitulo = nomeBloco(b);
    Estado.anexosVolta = 'fluxo';
    mostrarTela('anexos');
    renderizarAnexos();
  }

  function menuBloco(b) {
    const nAnexos = (b.anexos || []).length;
    const fim = b.forma === 'fim';
    const caso = b.forma === 'caso';
    mostrarSheet(tituloBloco(b), [
      {
        texto: caso ? 'Mudar a resposta' : 'Editar',
        descricao: caso ? 'Ex.: Sim, Não, Talvez' : 'Texto, símbolo, responsável e notas',
        acao: () => editarBloco(b),
      },
      fim ? null : {
        texto: 'Ligar a outro bloco',
        descricao: 'Depois toque no bloco que vem em seguida',
        acao: () => comecarLigacao(b),
      },
      ehTrabalho(b) ? {
        texto: b.concluido ? 'Reabrir etapa' : 'Marcar como concluída',
        cor: b.concluido ? null : 'sucesso',
        acao: () => alternarConcluido(b),
      } : null,
      caso ? null : { texto: nAnexos ? 'Anexos (' + nAnexos + ')' : 'Anexos', acao: () => abrirAnexosBloco(b) },
      { texto: 'Apagar bloco', cor: 'danger', acao: () => apagarBloco(b) },
    ]);
  }

  function menuLigacao(l) {
    const de = bloco(l.de);
    const para = bloco(l.para);
    const mudar = fn => { registrar(); fn(); salvar(); };
    mostrarSheet('Seta: ' + nomeBloco(de) + ' → ' + nomeBloco(para), [
      { texto: 'Rótulo "Sim"', acao: () => mudar(() => { l.rotulo = 'Sim'; }) },
      { texto: 'Rótulo "Não"', acao: () => mudar(() => { l.rotulo = 'Não'; }) },
      {
        texto: 'Escrever rótulo',
        acao: () => prompt('Rótulo da seta', 'Texto (até 40 letras):', 'Ex.: Urgente', l.rotulo || '',
          v => mudar(() => { l.rotulo = v.slice(0, 40); })),
      },
      l.rotulo ? { texto: 'Tirar rótulo', acao: () => mudar(() => { l.rotulo = ''; }) } : null,
      {
        texto: 'Inverter sentido',
        acao: () => {
          if (fluxo().ligacoes.some(o => o.de === l.para && o.para === l.de)) {
            toast('Já existe uma seta no sentido contrário.');
            return;
          }
          mudar(() => { const t = l.de; l.de = l.para; l.para = t; });
        },
      },
      {
        texto: 'Apagar seta',
        cor: 'danger',
        acao: () => mudar(() => { fluxo().ligacoes = fluxo().ligacoes.filter(x => x !== l); }),
      },
    ]);
  }

  /* Primeiro toque destaca o bloco; tocar no destacado abre o menu dele. */
  function tocarBloco(b) {
    if (E.ligandoDe) {
      const de = E.ligandoDe;
      E.ligandoDe = null;
      if (de === b.id) { render(); return; }
      if (fluxo().ligacoes.some(l => l.de === de && l.para === b.id)) {
        toast('Esses blocos já estão ligados.');
        render();
        return;
      }
      registrar();
      fluxo().ligacoes.push({ id: novoId(), de, para: b.id, rotulo: '' });
      E.sel = b.id;
      salvar();
      toast('Ligado.');
      return;
    }
    if (E.sel === b.id) {
      menuBloco(b);
      return;
    }
    Som.item();
    E.sel = b.id;
    render();
  }

  function tocarFundo() {
    if (E.ligandoDe) {
      E.ligandoDe = null;
      toast('Ligação cancelada.');
    } else {
      E.sel = null;
    }
    render();
  }

  function menuMais() {
    mostrarSheet(E.item.nome || 'Fluxograma', [
      { texto: 'Enquadrar', descricao: 'Ver o fluxo inteiro na tela', acao: centralizar },
      { texto: 'Salvar como imagem', descricao: 'PNG do fluxograma', acao: exportarPng },
    ]);
  }

  /* ---------------- PNG ---------------- */

  async function exportarPng() {
    if (!E.item) return;
    const f = fluxo();
    if (!f.blocos.length) { toast('O fluxograma está vazio.'); return; }
    try {
      const lim = limites(f);
      const margem = 32;
      const topo = 44;
      const w = Math.ceil(lim.maxX - lim.minX + margem * 2);
      const h = Math.ceil(lim.maxY - lim.minY + margem * 2 + topo);
      const svg = el('svg', { xmlns: NS, width: w, height: h, viewBox: '0 0 ' + w + ' ' + h });
      svg.appendChild(marcadores());
      svg.appendChild(el('rect', { x: 0, y: 0, width: w, height: h, fill: COR.fundo }));
      svg.appendChild(texto(E.item.nome || 'Fluxograma', {
        x: margem, y: margem, 'text-anchor': 'start', 'dominant-baseline': 'central',
        'font-size': 18, 'font-weight': 700, fill: COR.ouro,
      }));
      const desenho = montarDesenho(f, {});
      desenho.setAttribute('transform', 'translate(' + (margem - lim.minX) + ' ' + (margem + topo - lim.minY) + ')');
      svg.appendChild(desenho);

      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      await img.decode();
      // 2x para ficar nítido, sem passar de 4096 px no lado maior.
      const escala = Math.max(0.5, Math.min(2, 4096 / Math.max(w, h)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * escala);
      canvas.height = Math.round(h * escala);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('sem imagem');
      baixarArquivo(nomeArquivoSeguro(E.item.nome || 'fluxograma') + '.png', blob);
      toast('Imagem do fluxograma salva.');
    } catch (err) {
      toast('Não foi possível gerar a imagem.');
    }
  }

  /* ---------------- gestos ---------------- */

  function ligarEventos() {
    const canvas = $id('fluxo-canvas');
    const ponteiros = new Map();
    let gesto = null;
    let quadro = 0;

    const agendar = fn => {
      if (quadro) return;
      quadro = requestAnimationFrame(() => { quadro = 0; fn(); });
    };

    function iniciarPinca() {
      const [p1, p2] = Array.from(ponteiros.values());
      gesto = {
        tipo: 'pinca',
        dist: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
        cx: (p1.x + p2.x) / 2,
        cy: (p1.y + p2.y) / 2,
        zoom: E.zoom,
        panX: E.panX,
        panY: E.panY,
      };
    }

    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ponteiros.size === 2) {
        // Se um bloco estava sendo arrastado, ele fica onde estava.
        if (gesto && gesto.tipo === 'bloco' && gesto.moveu) guardar();
        iniciarPinca();
        return;
      }
      if (ponteiros.size > 2) return;
      const alvoBloco = e.target.closest && e.target.closest('[data-bloco]');
      const alvoSeta = e.target.closest && e.target.closest('[data-ligacao]');
      const b = alvoBloco ? bloco(alvoBloco.getAttribute('data-bloco')) : null;
      gesto = {
        tipo: b ? 'bloco' : 'pan',
        bloco: b,
        seta: alvoSeta ? alvoSeta.getAttribute('data-ligacao') : null,
        x0: e.clientX,
        y0: e.clientY,
        bx: b ? b.x : 0,
        by: b ? b.y : 0,
        panX: E.panX,
        panY: E.panY,
        moveu: false,
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });

    canvas.addEventListener('pointermove', e => {
      if (!ponteiros.has(e.pointerId) || !gesto) return;
      ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();

      if (gesto.tipo === 'pinca') {
        if (ponteiros.size < 2) return;
        const [p1, p2] = Array.from(ponteiros.values());
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const r = canvas.getBoundingClientRect();
        const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, gesto.zoom * dist / gesto.dist));
        // O ponto do desenho que estava entre os dedos continua entre eles.
        const mx = (gesto.cx - r.left - gesto.panX) / gesto.zoom;
        const my = (gesto.cy - r.top - gesto.panY) / gesto.zoom;
        E.zoom = z;
        E.panX = cx - r.left - mx * z;
        E.panY = cy - r.top - my * z;
        agendar(aplicarVista);
        return;
      }

      const dx = e.clientX - gesto.x0;
      const dy = e.clientY - gesto.y0;
      if (!gesto.moveu && Math.hypot(dx, dy) < 8) return;
      if (!gesto.moveu && gesto.tipo === 'bloco') registrar();   // mover também se desfaz
      gesto.moveu = true;
      if (gesto.tipo === 'bloco') {
        const b = gesto.bloco;
        b.x = arredondar(gesto.bx + dx / E.zoom);
        b.y = arredondar(gesto.by + dy / E.zoom);
        agendar(render);
      } else {
        E.panX = gesto.panX + dx;
        E.panY = gesto.panY + dy;
        agendar(aplicarVista);
      }
    });

    function terminar(e) {
      if (!ponteiros.has(e.pointerId)) return;
      ponteiros.delete(e.pointerId);
      const g = gesto;
      if (g && g.tipo === 'pinca') {
        // Sobrou um dedo: segue deslocando a vista a partir daqui, sem salto.
        if (ponteiros.size === 1) {
          const [p] = Array.from(ponteiros.values());
          gesto = { tipo: 'pan', x0: p.x, y0: p.y, panX: E.panX, panY: E.panY, moveu: true };
        } else if (ponteiros.size === 0) {
          gesto = null;
        }
        return;
      }
      if (ponteiros.size) return;
      gesto = null;
      if (!g || e.type === 'pointercancel') {
        if (g && g.tipo === 'bloco' && g.moveu) guardar();
        return;
      }
      if (g.tipo === 'bloco') {
        if (g.moveu) { render(); guardar(); }
        else tocarBloco(g.bloco);
        return;
      }
      if (!g.moveu) {
        const seta = g.seta ? fluxo().ligacoes.find(l => l.id === g.seta) : null;
        if (seta && !E.ligandoDe) menuLigacao(seta);
        else tocarFundo();
      }
    }

    canvas.addEventListener('pointerup', terminar);
    canvas.addEventListener('pointercancel', terminar);
    window.addEventListener('pointerup', terminar);
    window.addEventListener('pointercancel', terminar);

    canvas.addEventListener('wheel', e => {
      if (!e.deltaY) return;
      e.preventDefault();
      zoomEm(E.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
    }, { passive: false });

    $id('fluxo-novo').addEventListener('click', abrirSimbolos);
    $id('fluxo-desfazer').addEventListener('click', desfazer);
    $id('fluxo-refazer').addEventListener('click', refazer);
    $id('fluxo-mais').addEventListener('click', menuMais);
    $id('fluxo-voltar').addEventListener('click', voltar);

    // Atalhos no computador: Ctrl+Z desfaz, Ctrl+Y (ou Ctrl+Shift+Z) refaz.
    document.addEventListener('keydown', e => {
      if (Estado.tela !== 'fluxo' || !(e.ctrlKey || e.metaKey)) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); desfazer(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); refazer(); }
    });

    window.addEventListener('resize', () => {
      if (Estado.tela === 'fluxo') aplicarVista();
    });
  }

  ligarEventos();

  return { abrir, voltar, reabrir, exportarPng, quebrar, desfazer, refazer };
})();
