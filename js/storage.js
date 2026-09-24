'use strict';
document.documentElement.dataset.loadedstorage = '1';

/* ============================================================
 * Storage: IndexedDB.
 *  - loja "projetos": chave = id do projeto, valor = projeto
 *  - loja "arquivos": chave = id do anexo, valor = Blob
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
      const req = indexedDB.open('fractal', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projetos')) {
          db.createObjectStore('projetos', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('arquivos')) {
          db.createObjectStore('arquivos');
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
    listarProjetos: () => run('projetos', 'readonly', s => s.getAll()),
    carregarProjeto: id => run('projetos', 'readonly', s => s.get(id)),
    salvarProjeto: projeto => run('projetos', 'readwrite', s => s.put(projeto)),
    apagarProjeto: id => run('projetos', 'readwrite', s => s.delete(id)),

    // ---------- arquivos (Blob por id de anexo) ----------
    guardarArquivo: (id, blob) => run('arquivos', 'readwrite', s => s.put(blob, id)),
    pegarArquivo: id => run('arquivos', 'readonly', s => s.get(id)),
    apagarArquivo: id => run('arquivos', 'readwrite', s => s.delete(id)),
  };
})();

/* ============================================================
 * Modelo de dados (formato interno, camelCase)
 *  Projeto: { id, nome, modificado, raiz }
 *  Miolo:   { nome, anotacoes, itens[], anexos[] }
 *  Item:    { nome, cor, miolo }
 *  Anexo:   { id, nome, tipo, valor, adicionado, arquivo }
 * ============================================================ */

function novoMiolo(nome) {
  return { nome, anotacoes: '', itens: [], anexos: [] };
}

function novoItem(nome, cor) {
  return { nome: nome, cor: cor || 0, miolo: novoMiolo(nome) };
}

/* Traduz o JSON do desktop (.fractal, PascalCase) ou o formato interno. */
function mioloDoJson(d) {
  const origem = d || {};
  const nome = origem.nome != null ? origem.nome : origem.Nome != null ? origem.Nome : '';
  const anotacoes = origem.anotacoes != null ? origem.anotacoes : origem.Anotacoes != null ? origem.Anotacoes : '';
  const petalasSrc = origem.itens || origem.Petalas || [];
  const anexosSrc = origem.anexos || origem.Anexos || [];

  const miolo = novoMiolo(nome);
  miolo.anotacoes = anotacoes || '';

  miolo.itens = (petalasSrc || []).map((p, i) => {
    const cor = p.cor != null ? p.cor : p.Cor != null ? p.Cor : i % 10;
    const pNome = p.nome != null ? p.nome : p.Nome != null ? p.Nome : 'Sem nome';
    const pMiolo = p.miolo || p.Miolo;
    return {
      nome: pNome,
      cor: cor,
      anotacoes: p.anotacoes != null ? p.anotacoes : p.Anotacoes != null ? p.Anotacoes : '',
      miolo: pMiolo ? mioloDoJson(pMiolo) : novoMiolo(pNome),
    };
  });

  miolo.anexos = (anexosSrc || []).map(a => ({
    id: novoId(),
    nome: a.nome != null ? a.nome : a.Nome != null ? a.Nome : '',
    tipo: (a.tipo != null ? a.tipo : a.Tipo || 'link'),
    valor: a.valor != null ? a.valor : a.Valor != null ? a.Valor : '',
    adicionado: a.adicionado || a.Adicionado || new Date().toISOString(),
    arquivo: !ehLink(a.Valor != null ? a.Valor : a.valor),
  }));

  return miolo;
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
      Miolo: p.miolo ? mioloParaJson(p.miolo) : null,
    })),
    Anexos: (m.anexos || []).map(a => ({
      Nome: a.nome,
      Tipo: a.tipo,
      Valor: a.valor,
      Adicionado: a.adicionado,
    })),
  };
}

/* Percorre todos os anexos de uma árvore de miolos. */
function percorrerAnexos(miolo, acao) {
  const lista = [];
  (function andar(m) {
    (m.anexos || []).forEach(a => lista.push({ m, a }));
    (m.itens || []).forEach(i => { if (i.miolo) andar(i.miolo); });
  })(miolo);
  return Promise.all(lista.map(({ m, a }) => acao(m, a)));
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
    if (a.arquivo && emb[a.valor]) {
      await Storage.guardarArquivo(a.id, dataURIParaBlob(emb[a.valor]));
    }
  });

  const projeto = {
    id: novoId(),
    nome: origem.Nome || origem.nome || 'Projeto importado',
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
  let t = miolo.anexos.length;
  miolo.itens.forEach(i => { if (i.miolo) t += totalAnexos(i.miolo); });
  return t;
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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}