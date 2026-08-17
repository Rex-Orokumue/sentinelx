# SentinelX PWA Support — Design Spec

**Date:** 2026-08-17
**Status:** Approved → ready for implementation

---

## 1. Goal

Make SentinelX installable as a Progressive Web App (add-to-home-screen, standalone launch window, real app icon) with a narrow, deliberately conservative offline story: the static app shell and a short list of genuinely static pages work with no connection; every live-data page — which is nearly the whole site — shows an explicit offline page rather than risking a stale tournament/match/wallet view.

## 2. Icon Assets

No square icon art exists anywhere in the repo today — `public/logo-icon.png`, `app/icon.png`, and `app/apple-icon.png` are all the same 310×266 non-square file. Real home-screen and splash icons need proper square art.

**Generation approach:** a one-off Node script (`scripts/generate-pwa-icons.mjs`, run once, output committed to `public/`) uses `next/og`'s `ImageResponse` — already a project dependency via Next.js, already used for `opengraph-image.tsx` elsewhere — to composite `public/logo-icon.png` centered on a square `#0B0B0F` (the site's `sx-bg` token) canvas:

- `public/icon-192.png` — 192×192, logo filling ~80% of the canvas.
- `public/icon-512.png` — 512×512, same proportions.
- `public/icon-512-maskable.png` — 512×512, logo filling ~60% of the canvas (extra padding for Android's adaptive-icon safe zone, which crops maskable icons to various shapes).

These are static output files, not a dynamic route — generated once, committed, and only regenerated if the logo changes.

## 3. Web App Manifest

`app/manifest.ts` — Next.js's manifest file convention. Returns a `MetadataRoute.Manifest` object; Next.js auto-serves it at `/manifest.webmanifest` and auto-injects the `<link rel="manifest">` tag into every page's `<head>` — no manual metadata wiring needed.

```ts
{
  name: SITE_NAME,               // "SentinelX Esports" — reused from lib/seo/site.ts
  short_name: SITE_SHORT_NAME,   // "SentinelX"
  description: SITE_DESCRIPTION, // reused, not reinvented
  start_url: '/',
  display: 'standalone',
  background_color: '#0B0B0F',   // sx-bg
  theme_color: '#0B0B0F',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
```

`app/layout.tsx`'s existing `generateViewport`/`metadata` export gains `themeColor: '#0B0B0F'` and an `appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: SITE_SHORT_NAME }` block — iOS Safari doesn't read `manifest.json` for its home-screen behavior the way Chrome/Android does; these meta tags are what actually control the iOS "Add to Home Screen" appearance (standalone mode, status bar style, home-screen title).

**No custom install button.** The browser's native install affordance (desktop Chrome/Edge address-bar icon, mobile "Add to Home Screen" menu item) is what a valid manifest + service worker + HTTPS unlocks automatically. A custom `beforeinstallprompt`-driven button is a reasonable future enhancement but out of scope here — YAGNI.

## 4. Service Worker Unification

**Constraint:** a given URL scope can only be actively controlled by one service worker. `public/firebase-messaging-sw.js` already registers at the root scope (`/`) for push messaging (Task 10/11 of the notification-center plan). Registering a second, separate service worker for offline caching at the same default scope would not compose with it — the second registration simply replaces the first as the active controller.

**Resolution:** rename `public/firebase-messaging-sw.js` → `public/sw.js` and merge both concerns into the one file. `components/notifications/useFCM.ts`'s `requestPushPermission()` already explicitly registers the service worker and passes the registration into `getToken()` — Firebase has no hardcoded dependency on the literal filename `firebase-messaging-sw.js`, so the rename is safe as long as the registration call site is updated to match (it is, as part of this plan).

The unified `public/sw.js` has three responsibilities, layered in the same file:
1. Firebase init + `onBackgroundMessage` (unchanged from today — still reads its config from `self.location.search`, still calls `self.registration.showNotification()`).
2. `notificationclick` handling (unchanged).
3. New: an `install` handler that precaches the static allowlist (§5), and a `fetch` handler implementing the network-first-with-allowlist-fallback strategy (§5).

No Workbox or other new dependency — the caching surface is small and simple enough that a hand-rolled `fetch` event handler is more appropriate than pulling in a caching framework for it.

## 5. Offline Caching Strategy

**Principle:** live data is never served stale. Only the app shell and a short, explicitly-static allowlist of pages are cached; everything else is network-only, falling back to a dedicated `/offline` page (never a stale cached copy) if the network is unavailable.

**Precached on `install`** (the static allowlist):
- `/about`
- `/games`
- `/coming-soon`
- `/offline` (the fallback page itself)
- `/icon-192.png`, `/icon-512.png`, `/icon-512-maskable.png`, `/manifest.webmanifest`, `/logo-icon.png`

**Explicitly network-only, no cache, `/offline` fallback on failure** — everything else, including but not limited to:
`/`, `/tournaments`, `/tournaments/[slug]`, `/tournaments/[slug]/bracket`, `/tournaments/[slug]/results`, `/matches/[id]`, `/tv`, `/rankings`, `/players`, `/players/[username]`, `/hall-of-fame`, `/seasons/[slug]`, `/exchange`, `/exchange/[id]`, `/exchange/new`, `/exchange/requests/new`, `/store`, `/community`, `/community/[postId]`, `/dashboard` and every `/dashboard/*` subpage, `/admin` and every `/admin/*` subpage, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/onboarding/*`, and all `/api/*` routes.

**`fetch` handler logic** (navigation requests only — non-navigation requests such as JS/CSS chunks, fonts, and API calls always pass straight through to the network untouched, matching Next.js's own asset-hashing/caching, which the service worker must not interfere with):

```js
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return // let everything else pass through untouched
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(SHELL_CACHE)
      const cached = await cache.match(event.request)
      return cached ?? cache.match('/offline')
    }),
  )
})
```

Since the allowlist is the only thing ever in `SHELL_CACHE`, `cache.match(event.request)` only ever succeeds for those exact pages — every other navigation falls through to `/offline` on network failure, exactly matching the "live data is never stale" principle without needing an explicit include/exclude list inside the fetch handler itself.

## 6. New Page

`app/offline/page.tsx` — a static (no data fetching) page matching the site's dark/purple aesthetic: "You're offline" heading, a short explanation, and a "Try again" button (`location.reload()`). This is the page users land on for any live-data route when there's no connection.

## 7. Testing

No new unit-testable pure logic — this is manifest configuration, static icon generation, and browser-API-driven service worker code, matching this repo's established convention (confirmed repeatedly across the notification-center work) of verifying such code via clean `tsc`/`npm run build` rather than inventing component/browser-API test infrastructure. Manual verification: after deploy, confirm the manifest is served at `/manifest.webmanifest`, confirm Chrome DevTools' Application panel shows the manifest + service worker as valid/installable, and confirm `/about` still loads with the network disabled (DevTools offline throttling) while `/dashboard` correctly shows `/offline` instead.

## 8. Out of Scope

- Custom install-prompt UI (`beforeinstallprompt` button) — future enhancement.
- Caching any live-data page, even read-through/stale-while-revalidate — deliberately rejected per the design principle above.
- iOS push notifications (Safari 16.4+ supports Web Push but iOS PWA installability/testing is separately scoped) — already out of scope per the notification-center spec, unchanged here.
- Background sync, periodic sync, or any other advanced service-worker capability beyond install-time precache + fetch-time fallback.
