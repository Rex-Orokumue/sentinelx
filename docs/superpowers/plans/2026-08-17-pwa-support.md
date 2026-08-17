# PWA Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SentinelX installable (manifest, real square icons, standalone launch) with a deliberately narrow offline story — only the static app shell and a short allowlist of genuinely static pages work offline; every live-data page shows an explicit `/offline` page instead of anything stale.

**Architecture:** Icons are generated via Next.js dynamic image routes (`app/icon-*.png/route.tsx`, `export const dynamic = 'force-static'`) using `next/og`'s `ImageResponse` — the exact same mechanism `app/opengraph-image.tsx` already uses in this repo, just reading `public/logo-icon.png` from disk and compositing it onto a square canvas instead of rendering text. This is a refinement of the approved spec's "one-off script" — a route handler runs through Next's actual build/render pipeline (proven-compatible in this codebase, five existing `opengraph-image.tsx` files already do exactly this), where a bare Node script invoking `ImageResponse` outside that pipeline would be an unproven, unnecessary risk for the same result. Output is build-time-static (`force-static`), not committed binaries — regenerates automatically if the logo ever changes. Push messaging and offline caching are merged into one service worker (`public/sw.js`, renamed from `firebase-messaging-sw.js`) because a URL scope can only have one active controlling service worker — see spec §4.

**Tech Stack:** Next.js 14 App Router (`next/og` `ImageResponse`, `MetadataRoute.Manifest`, `Viewport` type), vanilla service worker (no Workbox).

**Spec:** `docs/superpowers/specs/2026-08-17-pwa-support-design.md` — read in full; this plan's icon-generation technique is a refinement of §2 as described above, everything else matches the spec directly.

## Global Constraints

- No caching of any live-data page, ever — not even stale-while-revalidate. Only the exact allowlist in spec §5 goes in `SHELL_CACHE`.
- Non-navigation requests (JS/CSS/fonts/API calls) must pass straight through the service worker untouched — never intercept `event.request.mode !== 'navigate'`.
- No new npm dependency (no Workbox, no next-pwa).
- `app/icon.png` / `app/apple-icon.png` (the existing non-square favicon/Apple-touch-icon files) are left untouched — out of scope per the approved spec. Note this as a known follow-up, don't silently expand scope to fix it now.
- No unit tests for this plan's code: manifest config, image-generating routes, and service worker code are browser/build-pipeline-bound with no isolable pure logic, matching this repo's established convention (already applied throughout the notification-center work) of verifying such code via clean `tsc`/`npm run build` rather than inventing test infrastructure for it. Every task ends with a build/tsc verification step instead of a test step.
- Reuse `SITE_NAME`, `SITE_SHORT_NAME`, `SITE_DESCRIPTION` from `lib/seo/site.ts` — do not hardcode duplicate copy.
- Brand colors: `#0B0B0F` (the `sx-bg` Tailwind token) for `background_color`/`theme_color`/icon canvas fill — do not invent a different shade.

---

### Task 1: Icon-generating routes

**Files:**
- Create: `app/icon-192.png/route.tsx`
- Create: `app/icon-512.png/route.tsx`
- Create: `app/icon-512-maskable.png/route.tsx`

**Interfaces:**
- Produces: three static image routes served at `/icon-192.png`, `/icon-512.png`, `/icon-512-maskable.png` — consumed by Task 2 (`app/manifest.ts`) and Task 4 (service worker precache list).

- [ ] **Step 1: `app/icon-192.png/route.tsx`**

```tsx
import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// force-static: the logo file doesn't change per-request, so Next.js
// prerenders this once at build time and serves it as a static asset from
// then on — no dependency on a standalone script running outside the
// Next.js pipeline (see plan Architecture note for why that was rejected).
export const dynamic = 'force-static'

async function logoDataUri(): Promise<string> {
  const buf = await readFile(join(process.cwd(), 'public/logo-icon.png'))
  return `data:image/png;base64,${buf.toString('base64')}`
}

// public/logo-icon.png is 310x266 (not square) — scaled here by its larger
// dimension (width) to ~80% of the canvas, preserving aspect ratio, rather
// than stretched to fill a square.
export async function GET() {
  const src = await logoDataUri()
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0B0B0F',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={154} height={132} />
      </div>
    ),
    { width: 192, height: 192 },
  )
}
```

- [ ] **Step 2: `app/icon-512.png/route.tsx`** — identical pattern, same 80%-of-canvas proportions scaled up:

```tsx
import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const dynamic = 'force-static'

async function logoDataUri(): Promise<string> {
  const buf = await readFile(join(process.cwd(), 'public/logo-icon.png'))
  return `data:image/png;base64,${buf.toString('base64')}`
}

export async function GET() {
  const src = await logoDataUri()
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0B0B0F',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={410} height={352} />
      </div>
    ),
    { width: 512, height: 512 },
  )
}
```

- [ ] **Step 3: `app/icon-512-maskable.png/route.tsx`** — same canvas size, logo scaled to ~60% instead of 80% (extra padding for Android's adaptive-icon safe zone):

```tsx
import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const dynamic = 'force-static'

async function logoDataUri(): Promise<string> {
  const buf = await readFile(join(process.cwd(), 'public/logo-icon.png'))
  return `data:image/png;base64,${buf.toString('base64')}`
}

export async function GET() {
  const src = await logoDataUri()
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0B0B0F',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={307} height={264} />
      </div>
    ),
    { width: 512, height: 512 },
  )
}
```

- [ ] **Step 4: Verify**

Run: `npm run build` — confirm the three routes appear in the build output route list with no errors, then `npm run dev` and open `http://localhost:3000/icon-192.png`, `/icon-512.png`, `/icon-512-maskable.png` directly in a browser to visually confirm each renders the logo centered on a dark square, sized as expected (adjust the `width`/`height` props on the `<img>` if the proportions look off before moving on — this is the one step in this plan worth eyeballing rather than trusting blindly).

- [ ] **Step 5: Commit**

```bash
git add "app/icon-192.png" "app/icon-512.png" "app/icon-512-maskable.png"
git commit -m "feat(pwa): generate square icon routes from the existing logo"
```

---

### Task 2: Manifest + layout metadata

**Files:**
- Create: `app/manifest.ts`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: the three icon routes (Task 1); `SITE_NAME`, `SITE_SHORT_NAME`, `SITE_DESCRIPTION` from `@/lib/seo/site` (existing).
- Produces: `/manifest.webmanifest`, auto-linked into every page's `<head>` by Next.js's manifest file convention.

- [ ] **Step 1: `app/manifest.ts`**

```ts
import type { MetadataRoute } from 'next'
import { SITE_NAME, SITE_SHORT_NAME, SITE_DESCRIPTION } from '@/lib/seo/site'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_SHORT_NAME,
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#0B0B0F',
    theme_color: '#0B0B0F',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
```

- [ ] **Step 2: `app/layout.tsx`** — add a `viewport` export (Next.js 14 moved `themeColor` out of `metadata` into a separate `viewport` export — do not add `themeColor` inside the existing `metadata` object, it's deprecated there and silently ignored) and an `appleWebApp` block inside the existing `metadata` object:

Add the import:

```ts
import type { Metadata, Viewport } from 'next'
```

(replacing the existing `import type { Metadata } from 'next'`)

Add, right after the closing `}` of the existing `export const metadata: Metadata = {...}` block:

```ts
export const viewport: Viewport = {
  themeColor: '#0B0B0F',
}
```

Inside the existing `metadata` object, add a new top-level field (alongside `openGraph`, `twitter`, etc.):

```ts
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: SITE_SHORT_NAME,
  },
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expect clean.
Run: `npm run build` — confirm `/manifest.webmanifest` appears in the build output, no errors.
Manual: `npm run dev`, open `http://localhost:3000/manifest.webmanifest`, confirm it returns valid JSON with the three icon URLs and correct colors. View page source on any page, confirm `<link rel="manifest" href="/manifest.webmanifest">` and `<meta name="theme-color" content="#0B0B0F">` are present in `<head>`.

- [ ] **Step 4: Commit**

```bash
git add app/manifest.ts app/layout.tsx
git commit -m "feat(pwa): web app manifest, theme-color, apple-web-app metadata"
```

---

### Task 3: `/offline` fallback page

**Files:**
- Create: `app/offline/page.tsx`

**Interfaces:**
- Produces: `/offline` — consumed by Task 4's service worker `fetch` handler as the ultimate fallback for any non-allowlisted navigation when the network is unavailable.

- [ ] **Step 1: `app/offline/page.tsx`**

```tsx
// No data fetching here by design — this page is served from the service
// worker's cache when there is no network at all, so anything beyond
// static markup would just fail. It still renders inside the root layout
// (SiteHeader/SiteFooter), which does its own Supabase session check —
// that's an accepted characteristic of caching full SSR'd pages, not
// something this page can control on its own.
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-bold text-white">You&apos;re offline</h1>
      <p className="mt-3 text-sm text-sx-gray">
        This page needs a connection to load. Static pages like this one still work — everything else (tournaments,
        matches, your dashboard) needs you back online.
      </p>
      <a
        href="/"
        className="mt-6 rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light"
      >
        Try again
      </a>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — expect clean.
Run: `npm run build` — confirm `/offline` appears in the route list.
Manual: `npm run dev`, open `http://localhost:3000/offline`, confirm it renders correctly.

- [ ] **Step 3: Commit**

```bash
git add app/offline/page.tsx
git commit -m "feat(pwa): add /offline fallback page"
```

---

### Task 4: Unify the service worker (push + offline caching)

**Files:**
- Create: `public/sw.js` (new content, superset of the old file)
- Delete: `public/firebase-messaging-sw.js`
- Modify: `components/notifications/useFCM.ts` (registration path)

**Interfaces:**
- Consumes: the allowlist from spec §5 (`/about`, `/games`, `/coming-soon`, `/offline`, icon/manifest/logo assets).
- Produces: a single service worker at `/sw.js` controlling the root scope — replaces `/firebase-messaging-sw.js` as the registration target used by `requestPushPermission()` (existing, `components/notifications/useFCM.ts`).

- [ ] **Step 1: Write `public/sw.js`**

```js
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
  '/logo-icon.png',
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
```

- [ ] **Step 2: Delete the old file**

```bash
git rm public/firebase-messaging-sw.js
```

- [ ] **Step 3: Update `useFCM.ts`'s registration path**

In `components/notifications/useFCM.ts`, inside `requestPushPermission()`, change:

```ts
  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${swQueryString()}`)
```

to:

```ts
  const registration = await navigator.serviceWorker.register(`/sw.js?${swQueryString()}`)
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expect clean (this file has no type errors to introduce, but confirms nothing else broke).
Run: `npx vitest run` — expect the full suite to still pass (this task touches no application logic, only a static asset and one string literal).
Run: `npm run build` — confirm clean build.

Manual (requires a real browser, cannot be scripted here): `npm run dev`, open DevTools → Application → Service Workers, confirm `/sw.js` registers successfully after clicking "Enable Push Notifications" in Settings (or after the dashboard banner). Confirm DevTools → Application → Cache Storage shows `sx-shell-v1` populated with the `SHELL_URLS` list after the service worker activates. With DevTools' Network tab set to "Offline," navigate to `/about` — confirm it still loads. Navigate to `/dashboard` — confirm `/offline` renders instead of a stale dashboard.

- [ ] **Step 5: Commit**

```bash
git add public/sw.js components/notifications/useFCM.ts
git commit -m "feat(pwa): unify push + offline caching into one service worker (public/sw.js)"
```

---

### Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `npx vitest run` — expect all tests passing, same count as before this plan (no new tests added, matching Global Constraints).

- [ ] **Step 2: Run the build**

Run: `npm run build` — expect a clean build with `/manifest.webmanifest`, `/offline`, and the three icon routes all present in the route list.

- [ ] **Step 3: Confirm installability**

In Chrome DevTools → Application → Manifest, confirm no errors/warnings are reported and all three icons load correctly in the preview. Confirm the "Install" affordance appears in the browser's address bar (desktop) after the manifest and service worker are both present and served over HTTPS (production/preview deployment — installability criteria are not met on `localhost` the same way in every Chrome version, so this check is most reliable against the actual Vercel deployment, not local dev).

- [ ] **Step 4: Report to the user**

Summarize: confirm the manifest, icons, and service worker are all live on the production deployment; note that `app/icon.png`/`app/apple-icon.png` (browser tab favicon / iOS Safari bookmark icon) were deliberately left as the old non-square files per the approved spec's scope — call this out explicitly as a known, intentional gap rather than an oversight, since a future pass could reuse this exact same icon-route technique to fix those too.

No commit for this task — it's a verification and reporting step.
