const CACHE = 'ios-long-screenshot-v4-cong-update';
const SHELL = ['./','./index.html','./style.css','./app.js','./watermark.js','./matcher.js','./match-worker.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, {cache:'reload'})))).then(() => self.skipWaiting()));
});
// Activate the new cache without navigating away from unsaved edits.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ios-long-screenshot-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(request, {cache:'no-cache',signal:controller.signal});
      if (response.ok) { await cache.put(request,response.clone()); return response; }
      return (await cache.match(request)) || response;
    } catch {
      return (await cache.match(request)) || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined) || new Response('Offline', {status:503});
    } finally { clearTimeout(timer); }
  })());
});
