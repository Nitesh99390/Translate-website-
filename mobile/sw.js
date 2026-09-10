/* Xplin Go — Service Worker (scope: /mobile/)
 *  - App shell: network-first with cache fallback
 *  - CDN libs & fonts: stale-while-revalidate
 *  - Google Translate / Firebase / ads: never intercepted
 */
const VERSION = 'xg-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL = [
  './', './index.html', './css/mobile.css',
  './js/core.js', './js/run.js', './js/export.js', './js/ui.js',
  './manifest.webmanifest',
  './assets/logo-192.png', './assets/logo-512.png', './assets/favicon-32.png', './assets/apple-touch-icon.png'
];

const BYPASS = ['translate.google', 'translate.googleapis', 'firebaseio.com', 'googleapis.com/identitytoolkit', 'accounts.google.com', 'adsterra', 'profitableratecpm', 'highperformanceformat'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('xg-') && !k.startsWith(VERSION)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || BYPASS.some(h => url.href.includes(h))) return;

  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) { const c = await caches.open(SHELL_CACHE); c.put(req, fresh.clone()).catch(() => {}); }
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') { const shell = await caches.match('./index.html'); if (shell) return shell; }
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // CDN libraries & fonts: stale-while-revalidate
  e.respondWith((async () => {
    const c = await caches.open(ASSET_CACHE);
    const cached = await c.match(req);
    const network = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {}); return res; }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
  })());
});
