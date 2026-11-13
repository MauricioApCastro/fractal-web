'use strict';
document.documentElement.dataset.loadedstorage = '1';

/* ============================================================
 * Storage: IndexedDB.
 *  - loja "projetos": chave = id do projeto, valor = projeto
 *  - loja "arquivos": chave = id do anexo, valor = Blob
 *  - loja "config":   chave = nome, valor = configuração (tokens, etc.)
 * ============================================================ */

function novoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const Storage = (() => {
  let dbP = null;

  function openDB() {
    if (dbP) return dbP;
    dbP = new Promise((resolve, reject) => {
      const req = indexedDB.open('fractal', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projetos')) {
          db.createObjectStore('projetos', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('arquivos')) {
          db.createObjectStore('arquivos');
        }
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbP;
  }

  function run(storeName, mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const pedido = fn(store);
      tx.oncomplete = () => resolve(pedido && 'result' in pedido ? pedido.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  return {
    // ---------- projetos ----------
    listarProjetos: () => run('projetos', 'readonly', s => s.getAll())
      .then(projetos => (projetos || []).map(compatibilizarProjeto)),
    carregarProjeto: id => run('projetos', 'readonly', s => s.get(id))
      .then(compatibilizarProjeto),
    salvarProjeto: projeto => run('projetos', 'readwrite', s => s.put(projeto)),
    apagarProjeto: id => run('projetos', 'readwrite', s => s.delete(id)),

    // ---------- arquivos (Blob por id de anexo) ----------
    guardarArquivo: (id, blob) => run('arquivos', 'readwrite', s => s.put(blob, id)),
    pegarArquivo: id => run('arquivos', 'readonly', s => s.get(id)),
    apagarArquivo: id => run('arquivos', 'readwrite', s => s.delete(id)),

    // ---------- configuração (tokens, preferências) ----------
    guardarConfig: (chave, valor) => run('config', 'readwrite', s => s.put(valor, chave)),
    pegarConfig: chave => run('config', 'readonly', s => s.get(chave)),
    apagarConfig: chave => run('config', 'readwrite', s => s.delete(chave)),

    // ---------- apagar tudo (LGPD, art. 18) ----------
    limparTudo: () => openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(['projetos', 'arquivos', 'config'], 'readwrite');
      tx.objectStore('projetos').clear();
      tx.objectStore('arquivos').clear();
      tx.objectStore('config').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    })),
  };
})();

/* ============================================================
 * Modelo de dados (formato interno, camelCase)
 *  Projeto: { id, nome, modificado, raiz }
 *  Miolo:   { nome, anotacoes, itens[], anexos[] }
 *  Item:    { nome, cor, concluido, miolo, tipo?, fluxo? }
 *  Anexo:   { id, nome, tipo, valor, adicionado, arquivo }
 *
 *  Item com tipo 'fluxo' guarda o desenho de um processo:
 *  Fluxo:   { blocos[], ligacoes[] }
 *  Bloco:   { id, forma, texto, x, y, notas, responsavel, concluido, anexos[] }
 *           forma: uma de FORMAS_FLUXO; x e y = centro.
 *  Ligação: { id, de, para, rotulo }   (de e para = id do bloco)
 * ============================================================ */

function novoMiolo(nome) {
  return { nome, anotacoes: '', itens: [], anexos: [] };
}

/* Compromisso de um item: data e hora (consulta, remédio...). Fica fora da
 * meta porque não tem progresso. repetir 'diario' serve para remédios: aí a
 * data não importa, só a hora. antes = minutos de antecedência do lembrete. */
const ANTECEDENCIAS = [0, 10, 30, 60, 120, 1440];

function normalizarCompromisso(c) {
  if (!c || typeof c !== 'object') return null;
  const hora = /^\d{2}:\d{2}$/.test(String(c.hora || '')) ? String(c.hora) : '';
  // 'mensal' é para contas: a data dá o primeiro vencimento e o dia do mês.
  const repetir = ['diario', 'mensal'].includes(c.repetir) ? c.repetir : 'nao';
  const data = /^\d{4}-\d{2}-\d{2}$/.test(String(c.data || '')) ? String(c.data) : '';
  if (!hora || (repetir !== 'diario' && !data)) return null;
  const antes = ANTECEDENCIAS.includes(Number(c.antes)) ? Number(c.antes) : 30;
  const normal = { data, hora, repetir, antes };
  // Conta paga até este mês (AAAA-MM): os avisos voltam no mês seguinte.
  if (repetir === 'mensal' && /^\d{4}-\d{2}$/.test(String(c.pagoAte || ''))) normal.pagoAte = c.pagoAte;
  return normal;
}

function novoItem(nome, cor) {
  return { nome: nome, cor: cor || 0, concluido: false, miolo: novoMiolo(nome) };
}

/* ---------- fluxograma ---------- */
/* Símbolos usuais de fluxograma. 'caso' é o ponto "Sim"/"Não" que sai de
 * uma decisão; o resto é a forma clássica de cada símbolo. */
const FORMAS_FLUXO = ['inicio', 'etapa', 'decisao', 'dados', 'documento', 'subprocesso', 'espera', 'fim', 'caso'];
/* Formas que são trabalho a fazer: contam no progresso e podem ser concluídas. */
const FORMAS_TRABALHO = ['etapa', 'decisao', 'dados', 'documento', 'subprocesso', 'espera'];

function ehFluxo(item) {
  return !!item && item.tipo === 'fluxo';
}

function novoBloco(forma, texto, x, y) {
  return {
    id: novoId(),
    forma: FORMAS_FLUXO.includes(forma) ? forma : 'etapa',
    texto: texto || '',
    x: Number(x) || 0,
    y: Number(y) || 0,
    notas: '',
    responsavel: '',
    concluido: false,
    anexos: [],
  };
}

/* Um fluxo novo já vem com Início ligado ao Fim: mostra como funciona. */
function novoFluxo() {
  const inicio = novoBloco('inicio', 'Início', 0, 0);
  const fim = novoBloco('fim', 'Fim', 0, 180);
  return {
    blocos: [inicio, fim],
    ligacoes: [{ id: novoId(), de: inicio.id, para: fim.id, rotulo: '' }],
  };
}

function novoItemFluxograma(nome, cor) {
  const item = novoItem(nome, cor);
  item.tipo = 'fluxo';
  item.fluxo = novoFluxo();
  return item;
}

/* Etapas, decisões e afins contam como trabalho; Início, Fim e os pontos
 * Sim/Não não. */
function progressoFluxo(fluxo) {
  const blocos = (fluxo && fluxo.blocos || []).filter(b => FORMAS_TRABALHO.includes(b.forma));
  return { total: blocos.length, feitos: blocos.filter(b => b.concluido === true).length };
}

function metaDoJson(d) {
  if (!d || typeof d !== 'object') return null;
  const diasBrutos = d.dias != null ? d.dias : d.Dias != null ? d.Dias :
    d.alvo != null ? d.alvo : d.Alvo;
  const dias = Math.max(1, Math.min(3650, Math.floor(Number(diasBrutos) || 30)));
  let progressoBruto = d.progresso != null ? d.progresso : d.Progresso;
  if (progressoBruto == null) {
    const marcados = d.dias || d.Dias;
    progressoBruto = Array.isArray(marcados) ? marcados.length : 0;
  }
  const progresso = Math.max(0, Math.min(dias, Math.floor(Number(progressoBruto) || 0)));
  const inicioBruto = d.inicio || d.Inicio || new Date().toISOString();
  const dataInicio = /^\d{4}-\d{2}-\d{2}$/.test(inicioBruto)
    ? new Date(inicioBruto + 'T12:00:00')
    : new Date(inicioBruto);
  const inicio = isNaN(dataInicio.getTime())
    ? new Date().toISOString()
    : dataInicio.getFullYear() + '-' + String(dataInicio.getMonth() + 1).padStart(2, '0') + '-' + String(dataInicio.getDate()).padStart(2, '0');
  let prazo = d.prazo || d.Prazo || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prazo)) {
    const data = new Date(inicio + 'T12:00:00');
    if (!isNaN(data.getTime())) {
      data.setDate(data.getDate() + dias);
      prazo = data.getFullYear() + '-' + String(data.getMonth() + 1).padStart(2, '0') + '-' + String(data.getDate()).padStart(2, '0');
    }
  }
  const prazoManual = d.prazoManual || d.PrazoManual || '';
  // O tipo precisa sobreviver: sem ele, a meta por contagem ganhava um prazo
  // calculado e passava a ser lida como meta por prazo ao reabrir o projeto.
  const tipoBruto = d.tipo || d.Tipo;
  const meta = { dias, progresso, inicio, prazo, prazoManual };
  if (tipoBruto === 'contagem' || tipoBruto === 'prazo') meta.tipo = tipoBruto;
  return meta;
}

/* Arquivos importados vêm de fora: força os tipos que o app espera, para um
 * .fractal malformado não quebrar a tela nem injetar valores estranhos. */
const TIPOS_ANEXO = ['imagem', 'video', 'link', 'arquivo'];

function textoDoJson(v, padrao) {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : padrao;
}

function listaDoJson(v) {
  return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
}

/* Traduz o JSON do desktop (.fractal, PascalCase) ou o formato interno. */
function mioloDoJson(d) {
  const origem = d && typeof d === 'object' ? d : {};
  const nome = textoDoJson(origem.nome != null ? origem.nome : origem.Nome, '');
  const anotacoes = textoDoJson(origem.anotacoes != null ? origem.anotacoes : origem.Anotacoes, '');
  const petalasSrc = listaDoJson(origem.itens || origem.Petalas);
  const anexosSrc = listaDoJson(origem.anexos || origem.Anexos);

  const miolo = novoMiolo(nome);
  miolo.anotacoes = anotacoes;

  miolo.itens = petalasSrc.map((p, i) => {
    const corBruta = Number(p.cor != null ? p.cor : p.Cor);
    const cor = Number.isFinite(corBruta) ? Math.trunc(corBruta) : i % 10;
    const pNome = textoDoJson(p.nome != null ? p.nome : p.Nome, 'Sem nome');
    const pMiolo = p.miolo || p.Miolo;
    const item = {
      nome: pNome,
      cor: cor,
      concluido: p.concluido === true || p.Concluido === true || p.feito === true || p.Feito === true,
      concluidoEm: textoDoJson(p.concluidoEm != null ? p.concluidoEm : p.ConcluidoEm, null),
      meta: metaDoJson(p.meta || p.Meta),
      compromisso: normalizarCompromisso(p.compromisso || p.Compromisso),
      anotacoes: textoDoJson(p.anotacoes != null ? p.anotacoes : p.Anotacoes, ''),
      miolo: pMiolo ? mioloDoJson(pMiolo) : novoMiolo(pNome),
    };
    if ((p.tipo != null ? p.tipo : p.Tipo) === 'fluxo') {
      item.tipo = 'fluxo';
      item.fluxo = fluxoDoJson(p.fluxo || p.Fluxo, true);
    }
    return item;
  });

  miolo.anexos = anexosSrc.map(anexoDoJson);

  return miolo;
}

/* Anexo vindo de um arquivo importado: ganha id novo neste aparelho. */
function anexoDoJson(a) {
  const tipo = a.tipo != null ? a.tipo : a.Tipo;
  const valor = textoDoJson(a.valor != null ? a.valor : a.Valor, '');
  return {
    id: novoId(),
    nome: textoDoJson(a.nome != null ? a.nome : a.Nome, ''),
    tipo: TIPOS_ANEXO.includes(tipo) ? tipo : 'link',
    valor: valor,
    adicionado: textoDoJson(a.adicionado || a.Adicionado, new Date().toISOString()),
    arquivo: !ehLink(valor),
  };
}

function campoDoJson(o, interno, exportado) {
  return o[interno] != null ? o[interno] : o[exportado];
}

function coordenadaDoJson(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-100000, Math.min(100000, n)) : 0;
}

/* Lê um fluxo do formato interno ou do exportado (PascalCase) e descarta o
 * que não faz sentido: forma desconhecida, ligação para bloco que não existe,
 * ligação repetida ou de um bloco para ele mesmo. Com importado=true os
 * anexos ganham id novo, como os do miolo; senão ficam como estão. */
function fluxoDoJson(d, importado) {
  const origem = d && typeof d === 'object' ? d : {};
  const ids = new Set();
  const blocos = listaDoJson(campoDoJson(origem, 'blocos', 'Blocos')).map(b => {
    let id = textoDoJson(campoDoJson(b, 'id', 'Id'), '');
    if (!id || ids.has(id)) id = novoId();
    ids.add(id);
    const forma = campoDoJson(b, 'forma', 'Forma');
    const anexos = listaDoJson(campoDoJson(b, 'anexos', 'Anexos'));
    return {
      id,
      forma: FORMAS_FLUXO.includes(forma) ? forma : 'etapa',
      texto: textoDoJson(campoDoJson(b, 'texto', 'Texto'), ''),
      x: coordenadaDoJson(campoDoJson(b, 'x', 'X')),
      y: coordenadaDoJson(campoDoJson(b, 'y', 'Y')),
      notas: textoDoJson(campoDoJson(b, 'notas', 'Notas'), ''),
      responsavel: textoDoJson(campoDoJson(b, 'responsavel', 'Responsavel'), ''),
      concluido: campoDoJson(b, 'concluido', 'Concluido') === true,
      anexos: importado ? anexos.map(anexoDoJson) : anexos,
    };
  });

  const pares = new Set();
  const ligacoes = [];
  listaDoJson(campoDoJson(origem, 'ligacoes', 'Ligacoes')).forEach(l => {
    const de = textoDoJson(campoDoJson(l, 'de', 'De'), '');
    const para = textoDoJson(campoDoJson(l, 'para', 'Para'), '');
    const par = de + '>' + para;
    if (!ids.has(de) || !ids.has(para) || de === para || pares.has(par)) return;
    pares.add(par);
    ligacoes.push({
      id: textoDoJson(campoDoJson(l, 'id', 'Id'), '') || novoId(),
      de,
      para,
      rotulo: textoDoJson(campoDoJson(l, 'rotulo', 'Rotulo'), '').slice(0, 40),
    });
  });

  return { blocos, ligacoes };
}

function fluxoParaJson(f) {
  const fluxo = f || { blocos: [], ligacoes: [] };
  return {
    Blocos: (fluxo.blocos || []).map(b => ({
      Id: b.id,
      Forma: b.forma,
      Texto: b.texto || '',
      X: b.x,
      Y: b.y,
      Notas: b.notas || '',
      Responsavel: b.responsavel || '',
      Concluido: b.concluido === true,
      Anexos: (b.anexos || []).map(anexoParaJson),
    })),
    Ligacoes: (fluxo.ligacoes || []).map(l => ({
      Id: l.id,
      De: l.de,
      Para: l.para,
      Rotulo: l.rotulo || '',
    })),
  };
}

function compatibilizarMiolo(m) {
  if (!m || typeof m !== 'object') return m;
  if (m.concluido == null && m.feito != null) m.concluido = m.feito === true;
  if (m.meta) m.meta = metaDoJson(m.meta);
  if (Array.isArray(m.itens)) m.itens.forEach(compatibilizarMiolo);
  return m;
}

/* Garante um fluxo válido em todo item do tipo fluxo, em qualquer nível. */
function compatibilizarFluxos(miolo) {
  if (!miolo || !Array.isArray(miolo.itens)) return;
  miolo.itens.forEach(item => {
    if (ehFluxo(item)) item.fluxo = fluxoDoJson(item.fluxo, false);
    if (item && item.miolo) compatibilizarFluxos(item.miolo);
  });
}

function compatibilizarProjeto(projeto) {
  if (projeto && projeto.raiz) {
    compatibilizarMiolo(projeto.raiz);
    compatibilizarFluxos(projeto.raiz);
  }
  return projeto;
}

/* Exporta para o formato do desktop (.fractal). */
function mioloParaJson(m) {
  return {
    Nome: m.nome,
    Anotacoes: m.anotacoes || '',
    Petalas: (m.itens || []).map(p => ({
      Nome: p.nome,
      Anotacoes: p.anotacoes || '',
      Cor: p.cor,
      Concluido: p.concluido === true,
      Feito: p.concluido === true,
      ConcluidoEm: p.concluidoEm || null,
      Meta: p.meta ? {
        Dias: p.meta.dias,
        Progresso: p.meta.progresso,
        Inicio: p.meta.inicio,
        Prazo: p.meta.prazo,
        PrazoManual: p.meta.prazoManual || '',
        Tipo: p.meta.tipo || '',
      } : null,
      Compromisso: normalizarCompromisso(p.compromisso),
      // undefined some do JSON: item comum continua igual ao do desktop.
      Tipo: ehFluxo(p) ? 'fluxo' : undefined,
      Fluxo: ehFluxo(p) ? fluxoParaJson(p.fluxo) : undefined,
      Miolo: p.miolo ? mioloParaJson(p.miolo) : null,
    })),
    Anexos: (m.anexos || []).map(anexoParaJson),
  };
}

function anexoParaJson(a) {
  return {
    Nome: a.nome,
    Tipo: a.tipo,
    Valor: a.valor,
    Adicionado: a.adicionado,
  };
}

/* Todos os anexos de uma árvore de miolos: os de cada miolo e os de cada
 * bloco de fluxograma, em qualquer nível. É o único lugar que sabe onde os
 * anexos moram; backup, importação, contagem e sincronização usam esta
 * lista. Devolve [{ dono, a }], onde dono é o miolo ou o bloco. */
function anexosDaArvore(miolo) {
  const lista = [];
  (function andar(m) {
    if (!m) return;
    (m.anexos || []).forEach(a => lista.push({ dono: m, a }));
    (m.itens || []).forEach(i => {
      if (!i) return;
      if (i.fluxo && Array.isArray(i.fluxo.blocos)) {
        i.fluxo.blocos.forEach(b => (b.anexos || []).forEach(a => lista.push({ dono: b, a })));
      }
      if (i.miolo) andar(i.miolo);
    });
  })(miolo);
  return lista;
}

/* Percorre todos os anexos de uma árvore de miolos. */
function percorrerAnexos(miolo, acao) {
  return Promise.all(anexosDaArvore(miolo).map(({ dono, a }) => acao(dono, a)));
}

function ehLink(valor) {
  return /^https?:\/\//i.test(String(valor || ''));
}

/* ---- utilidades de exportação/importação ---- */

function paraBase64(buffer) {
  let bin = '';
  const bytes = new Uint8Array(buffer);
  const tam = bytes.length;
  const pedaco = 0x8000;
  for (let i = 0; i < tam; i += pedaco) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + pedaco));
  }
  return btoa(bin);
}

function dataURIParaBlob(dataURI) {
  const parte = dataURI.split(',');
  const mime = (parte[0].match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(parte[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function anexosEmbarcados(miolo) {
  const mapa = {};
  await percorrerAnexos(miolo, async (_m, a) => {
    if (!a.arquivo || !a.valor || mapa[a.valor]) return;
    const blob = await Storage.pegarArquivo(a.id);
    if (!blob) return;
    const mime = blob.type || 'application/octet-stream';
    mapa[a.valor] = 'data:' + mime + ';base64,' + paraBase64(await blob.arrayBuffer());
  });
  return mapa;
}

async function exportarProjeto(projeto) {
  const emb = await anexosEmbarcados(projeto.raiz);
  const doc = {
    Nome: projeto.nome,
    Modificado: projeto.modificado,
    Raiz: mioloParaJson(projeto.raiz),
    anexos_embedded: emb,
  };
  return new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
}

function baixarArquivo(nome, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function importarProjeto(dados) {
  const origem = typeof dados === 'string' ? JSON.parse(dados) : dados;
  const raiz = mioloDoJson(origem.Raiz || origem.raiz);
  const emb = origem.anexos_embedded || {};

  await percorrerAnexos(raiz, async (_m, a) => {
    const dataURI = Object.prototype.hasOwnProperty.call(emb, a.valor) ? emb[a.valor] : null;
    if (a.arquivo && typeof dataURI === 'string' && dataURI.startsWith('data:')) {
      await Storage.guardarArquivo(a.id, dataURIParaBlob(dataURI));
    }
  });

  const projeto = {
    id: novoId(),
    nome: textoDoJson(origem.Nome || origem.nome, '') || 'Projeto importado',
    modificado: new Date().toISOString(),
    raiz,
  };
  await Storage.salvarProjeto(projeto);
  return projeto;
}

/* Contagens úteis para a lista de projetos. */
function totalItens(miolo) {
  let t = miolo.itens.length;
  miolo.itens.forEach(i => { if (i.miolo) t += totalItens(i.miolo); });
  return t;
}

function totalAnexos(miolo) {
  return anexosDaArvore(miolo).length;
}

/* ---------- paleta de cores (igual ao desktop) ---------- */
const PALETA = [
  ['#4FA8FF', '#2458C9'], ['#B26BFF', '#6C2BD9'], ['#FF6BB3', '#C2266C'],
  ['#FF5A5A', '#C21E1E'], ['#FFA446', '#E8660C'], ['#FFD94F', '#E8A400'],
  ['#38D9A9', '#0C7C5B'], ['#51E08A', '#1E9E4A'], ['#3BD6F0', '#0C6F8C'],
  ['#FF5C97', '#A1124E'],
];
const COR_MIOLO = ['#FFD86B', '#F5850C'];

function corDoItem(indice) {
  const c = PALETA[Math.abs(indice || 0) % PALETA.length];
  return c;
}

function extMime(ext, fallback) {
  const tabela = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime', '.wmv': 'video/x-ms-wmv', '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg', '.pdf': 'application/pdf',
  };
  return tabela[ext.toLowerCase()] || fallback;
}

function extDe(nome) {
  const i = String(nome || '').lastIndexOf('.');
  if (i < 0) return '.bin';
  const ext = nome.slice(i).toLowerCase();
  return /^\.\w+$/.test(ext) ? ext : '.bin';
}

/* ============================================================
 * PWA: registrar o service worker.
 * Registro relativo para funcionar em subpastas (GitHub Pages).
 * ============================================================ */
function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return;
  } catch (err) { /* segue o fluxo normal */ }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=21', { updateViaCache: 'none' }).catch(() => {});
  });
}