/* LifeSpan 健康預測 — Service Worker（離線快取）
   策略：
   - 導覽（HTML）：網路優先，離線時回退到已快取的 index.html
   - 同源靜態檔（icon/manifest）：快取優先
   - 跨網域 CDN（Chart.js/Firebase/pdf.js/字型…）：快取優先，未命中則抓取並存入（含 opaque 回應）
   換版：改 CACHE 版本號即會在 activate 時清掉舊快取。 */
const CACHE = 'lifespan-cache-2026.07.23-crossmed';

/* App shell（同源，必存）*/
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

/* CDN 相依（跨網域，盡力預存；抓不到不擋安裝）*/
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/tabler-icons.min.css',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=DM+Mono:wght@500&display=swap',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js',
  'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js',
  'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.52/dist/zip-full.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 核心檔案必須成功
    await c.addAll(CORE).catch(() => {});
    // CDN 逐一盡力（no-cors 取得 opaque 也存，離線可用）
    await Promise.all(CDN.map(async (u) => {
      try {
        const res = await fetch(new Request(u, { mode: 'no-cors' }));
        if (res && (res.ok || res.type === 'opaque')) await c.put(u, res.clone());
      } catch (_) {}
    }));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Google 登入／日曆 API：一律網路直通，絕不快取（避免快取到私人日曆或登入元件）
  try {
    const h = new URL(req.url).hostname;
    if (h === 'accounts.google.com' || h === 'apis.google.com' ||
        h === 'oauth2.googleapis.com' || /\.googleapis\.com$/.test(h) || h === 'googleapis.com') {
      e.respondWith(fetch(req).catch(() => Response.error()));
      return;
    }
  } catch (_) {}

  // 導覽請求：網路優先，離線回退 index.html
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./index.html', net.clone()).catch(() => {});
        return net;
      } catch (_) {
        return (await caches.match('./index.html')) ||
               (await caches.match('./')) ||
               new Response('離線中，且尚未快取頁面。請先在有網路時開啟一次。', {
                 status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
               });
      }
    })());
    return;
  }

  // 其餘（腳本／樣式／字型／圖片／CDN）：快取優先
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: false });
    if (cached) return cached;
    try {
      const net = await fetch(req);
      if (net && (net.ok || net.type === 'opaque')) {
        const c = await caches.open(CACHE);
        c.put(req, net.clone()).catch(() => {});
      }
      return net;
    } catch (_) {
      // 字型檔可能帶查詢字串，放寬比對
      const loose = await caches.match(req, { ignoreSearch: true });
      return loose || Response.error();
    }
  })());
});
