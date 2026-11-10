// Service worker: guarda las pantallas en el equipo para que la app abra sin internet.
// Al cambiar archivos, subí CACHE (y CELLCOM_VERSION en config.js) para que los equipos se actualicen.
const CACHE = 'cellcom-v6';
const ARCHIVOS = [
  './', './index.html', './estilos.css', './config.js', './manifest.webmanifest',
  './js/app.js', './js/stock.js', './lib/xlsx.full.min.js', './lib/html5-qrcode.min.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Pantallas: primero la red (para tener siempre lo último). Si no hay internet o tarda
// más de 4 segundos, usa lo guardado. Las llamadas al servidor (POST) no se tocan.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const guardado = () => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'));
    try {
      const red = fetch(req).then(r => {
        if (r && r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
        return r;
      });
      const lento = new Promise((_, no) => setTimeout(() => no(new Error('lento')), 4000));
      return await Promise.race([red, lento]);
    } catch (err) {
      const r = await guardado();
      return r || fetch(req);
    }
  })());
});
