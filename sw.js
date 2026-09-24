'use strict';

/* ============================================================
 * Service worker do Fractal.
 * Uso relativo para funcionar do GitHub Pages (subpasta).
 *
 * Estratégia:
 *  - navegação e JS/CSS: NETWORK-FIRST (sempre busca versão nova,
 *    cai para o cache se estiver offline) => atualizações entram
 *    logo e um cache corrompido se auto-repara;
 *  - demais ativos (ícones, manifest): cache-first + revalidação
 *    em segundo plano.
 * ============================================================ */

const CACHE = 'fractal-v2';

const CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/storage.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function atualizarCache(req, res) {
  const copia = res.clone();
  caches.open(CACHE).then(c => c.put(req, copia));
}

async function redePrimeiro(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) atualizarCache(req, res);
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const index = await caches.match('./index.html');
      if (index) return index;
    }
    throw err;
  }
}

async function cachePrimeiro(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) atualizarCache(req, res);
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const ehCodigo = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  event.respondWith(
    (req.mode === 'navigate' || ehCodigo) ? redePrimeiro(req) : cachePrimeiro(req)
  );
});