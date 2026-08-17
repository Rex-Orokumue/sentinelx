// Single service worker for the whole site — a URL scope can only have one
// active controlling service worker, so push messaging (originally
// firebase-messaging-sw.js) and offline caching are merged here rather than
// registered as two separate, conflicting workers. Config values can't
// reach a service worker via process.env (there's no bundler step for
// files under public/), so useFCM.ts passes them as URL query params when
// it registers this worker, read here from `self.location.search`.
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

const params = new URLSearchParams(self.location.search)
firebase.initializeApp({
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? 'SentinelX'
  self.registration.showNotification(title, {
    body: payload.notification?.body,
    icon: '/logo-icon.png',
    data: payload.data,
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(clients.openWindow(url))
})

// ---- Offline caching (spec 2026-08-17-pwa-support-design.md §5) ----
// Only the static app shell + a short explicit allowlist of genuinely
// static pages are ever cached. Everything else — which is nearly the
// whole site — is network-only, falling back to /offline (never a stale
// copy) when the network is unavailable.
const SHELL_CACHE = 'sx-shell-v1'
const SHELL_URLS = [
  '/about',
  '/games',
  '/coming-soon',
  '/offline',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-512-maskable.png',
  '/manifest.webmanifest',
  '/logo.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  // Only intercept page navigations — JS/CSS/font/API requests pass
  // straight through untouched, letting Next.js's own asset caching work
  // exactly as it already does.
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(SHELL_CACHE)
      const cached = await cache.match(event.request)
      return cached ?? cache.match('/offline')
    }),
  )
})
