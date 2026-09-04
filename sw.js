/* Doc Translator — Service Worker
 * Strategy:
 *  - App shell (HTML/CSS/JS): network-first with cache fallback (so updates land fast, offline still works)
 *  - CDN libs & fonts: stale-while-revalidate
 *  - Firebase / Google Translate / ads: never intercepted
 */
const VERSION = 'dtv-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/pro.js',
  './js/firebase.js',
  './js/odometer.js',
  './js/cloud-sync.js',
  './manifest.webmanifest'
];

const BYPASS_HOSTS = [
  'firebaseio.com', 'googleapis.com/identitytoolkit', 'firebase.googleapis.com',
  'translate.google', 'translate.googleapis', 'gstatic.com/firebasejs',
  'highperformanceformat.com', 'effectivegatecpm.com', 'adsterra', 'profitableratecpm'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

function shouldBypass(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  const s = url.href;
  return BYPASS_HOSTS.some(h => s.includes(h));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (shouldBypass(url)) return;

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // Network-first for the app shell
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const c = await caches.open(SHELL_CACHE);
          c.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })());
    return;
  }

  // Stale-while-revalidate for CDN libraries and fonts
  e.respondWith((async () => {
    const c = await caches.open(ASSET_CACHE);
    const cached = await c.match(req);
    const network = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
