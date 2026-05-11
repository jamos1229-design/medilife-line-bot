// Medilife Service Worker
// HTMLは常にネットワークから取得（最新版を保証）
// CDN等は初回キャッシュして高速化

const CACHE = 'medilife-v1';

self.addEventListener('install', () => {
  self.skipWaiting(); // 即座に新しいSWを有効化
});

self.addEventListener('activate', e => {
  // 古いキャッシュを全削除
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()) // 全タブを即座に制御下に
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // app.html は常にネットワーク優先（最新版を取得）
  if (url.pathname.includes('app.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request)) // オフライン時はキャッシュを使用
    );
    return;
  }

  // React/Babel等のCDNはキャッシュ優先（高速読み込み）
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
