const CACHE = 'refrater-v6.22';

// App shell — static assets to cache on install
const SHELL = [
  '/',
  '/index.html',
  '/matches.html',
  '/referees.html',
  '/fantasy.html',
  '/badges.html',
  '/login.html',
  '/shared.js',
  '/images/logos/RRLogo.svg',
  '/images/logos/ref_rater_logo_green_a.svg',
  '/images/badges/redcardbadge.png',
  '/images/badges/yellowcardbadge.png',
  '/images/badges/consultingvarbadge.png',
  '/CSV/Images/RefVAR-removebg-preview.png',
  '/CSV/Images/RefYellow-removebg-preview.png',
  '/CSV/Images/RefPantomime-removebg-preview.png',
  '/CSV/image__5_-removebg-preview.png',
];

// Install — cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// Activate — delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache-first for shell assets, network-first for Supabase/API calls
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go to network for external APIs, Supabase, CDN scripts
  if (
    url.hostname.includes('supabase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('googleusercontent') ||
    url.hostname.includes('jsdelivr') ||
    url.hostname.includes('fonts.g') ||
    url.hostname.includes('football-data.org') ||
    url.hostname.includes('pagead2.googlesyndication') ||
    url.pathname.startsWith('/.netlify/functions/') ||
    e.request.method !== 'GET'
  ) {
    return; // let browser handle it normally
  }

  // Cache-first for everything else (app shell, images, JS)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Cache successful same-origin responses
        if (res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
