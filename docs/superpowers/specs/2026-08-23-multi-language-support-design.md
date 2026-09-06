# Multi-Language Support — Design Spec

**Date:** 2026-08-23
**Status:** Draft → awaiting review

---

## 1. Goal

Make SentinelX usable in English, French, and Nigerian Pidgin, covering every static UI surface (public pages, dashboard, admin dashboard) and every notification a player receives (push, in-app, WhatsApp) — while leaving user- and admin-authored free-text content (tournament descriptions, community posts, exchange listings, comments) untranslated, and building the underlying architecture so more languages are cheap to add later.

## 2. Languages

| Code | Language | v1? |
|------|----------|-----|
| `en` | English | Yes — default, unprefixed |
| `fr` | French | Yes |
| `pcm` | Nigerian Pidgin | Yes |

`pcm` is the real ISO 639-3 code for Nigerian Pidgin. Adding a fourth language later means adding one more entry to a locale list plus one more JSON file — the architecture below doesn't hardcode "three."

## 3. Library: `next-intl`

The standard Next.js App Router i18n library — JSON message catalogs, a `useTranslations()` hook usable in both server and client components, `getTranslations({ locale })` usable outside of request context (needed for §7), built-in locale-prefixed routing middleware, and per-locale `generateMetadata`/hreflang support. Compatible with Next.js 14.2 (current version). Not in `package.json` today; this spec adds it as a new dependency. Rolling a custom solution would reimplement all of this for no benefit; an embedded-translate-widget approach (e.g. Google Translate widget) is rejected — it doesn't produce real indexable per-language pages, which fails CLAUDE.md's SEO rules outright.

## 4. Routing & Migration

**Structure:** the app tree moves under `app/[locale]/...`, with `en` unprefixed (`localePrefix: 'as-needed'` in next-intl's config) — `/tournaments/x` keeps working exactly as today for English (no broken bookmarks/backlinks/search rankings), while French and Pidgin get real prefixes: `/fr/tournaments/x`, `/pcm/tournaments/x`.

**What moves under `[locale]`:** `(auth)`, `(public)`, `admin`, `dashboard`, `seasons`, `store`, and root `page.tsx`.

**What stays at the true root, untouched:** `api/` (JSON endpoints have no locale), `favicon.ico`/`icon.tsx`/`apple-icon.tsx`/`icon-192.png`/`icon-512.png`/`icon-512-maskable.png` (icon conventions, just fixed this session), `manifest.ts`, `robots.ts`, `fonts/`, `globals.css`. `sitemap.ts` and `opengraph-image.tsx` stay root-level as files but their *content* changes (§9).

**`app/layout.tsx`** becomes a thin `<html><body>` shell; a new `app/[locale]/layout.tsx` wraps children in next-intl's `NextIntlClientProvider` and loads that locale's message catalog.

**`app/offline/page.tsx`** (the PWA offline fallback) is deliberately **excluded** from the locale prefix — `public/sw.js`'s fetch handler falls back to the literal path `/offline` on network failure, and localizing a rare, low-value utility page isn't worth the complexity of teaching the service worker which locale the user was on. It stays a single, locale-neutral page at `/offline` regardless of viewer language.

**`public/sw.js`'s precached shell allowlist** (`/about`, `/games`, `/coming-soon`, per the PWA spec) needs updating: those three pages now exist at three locale variants each (e.g. `/about`, `/fr/about`, `/pcm/about`). Precache all nine — it's a handful of small static pages, not worth the complexity of teaching the service worker the current viewer's locale at `install` time just to precache one variant.

**Middleware — the highest-risk integration point.** `middleware.ts` today does exactly one thing: Supabase session refresh + `/dashboard`/`/admin` auth guarding (`lib/supabase/middleware.ts`'s `updateSession`). next-intl needs its own middleware (`createMiddleware` from `next-intl/middleware`) to resolve the locale and rewrite the request. These have to run together — locale resolution must not skip the auth guard, and a redirect from the auth guard (e.g. unauthenticated `/dashboard` → `/login`) must preserve the resolved locale prefix. This needs explicit test coverage in the implementation plan, not just a visual check.

## 5. Locale Resolution & Storage

**New column:** `profiles.locale text not null default 'en' check (locale in ('en','fr','pcm'))` — same pattern as existing `check`-constrained columns in this schema (e.g. `player_notifications_type_check`).

**Resolution order:**
1. Logged-in player → `profiles.locale`
2. Anonymous visitor → `NEXT_LOCALE` cookie (next-intl's convention), set by a header/footer language switcher
3. First-ever visit, no cookie → browser `Accept-Language` header
4. Fallback → `en`

The switcher writes the `NEXT_LOCALE` cookie always, and additionally updates `profiles.locale` when logged in — so a signed-in player's language choice follows them across devices, matching how `notification_prefs` already works. Signup seeds the new profile's `locale` from whatever `NEXT_LOCALE` cookie the visitor already had (i.e. whatever locale they were browsing in when they signed up), not a hardcoded `en` — otherwise a player who registers while browsing the French site would silently get English notifications from their very first one.

## 6. UI Translation Content

One JSON message catalog per locale (`messages/en.json`, `messages/fr.json`, `messages/pcm.json`), organized into top-level namespaces mirroring feature areas (`nav`, `home`, `tournaments`, `matches`, `rankings`, `players`, `hallOfFame`, `exchange`, `community`, `dashboard`, `admin`, `auth`, `static` for about/rules/etc., …) — one file per locale rather than one file per page-per-locale, since three files is still easy to navigate and splitting further is easy to do later if any single file gets unwieldy.

**First draft:** I generate `fr.json` (machine-translation-assisted, since French has strong MT support) and `pcm.json` (best-effort — Pidgin is a low-resource language with poor MT coverage, so this draft leans on judgment more than translation tooling) from the English source. **Both need human review before shipping** — this spec produces a working, reviewable draft, not final signed-off copy.

## 7. Notification Copy Translation

29 files across `lib/` build or send notification content today (push via FCM, in-app via `player_notifications`, WhatsApp via Termii/Meta). All of it moves from hardcoded English template strings to the same locale-catalog mechanism as the UI, under a `notifications` namespace, using ICU message syntax for interpolated values (`"resultConfirmed": "{playerName}, your result for {tournamentTitle} was confirmed!"`).

**Key design point:** a notification renders in the **recipient's** locale (`profiles.locale`), never the actor's. If an English-speaking admin confirms a result for a `pcm`-locale player, that player's push/in-app/WhatsApp text is Pidgin. Every call site listed above (`pushToPlayer`, `notifyInApp`, `notifyStaff`, `sendWhatsApp`, and the cron routes) needs to resolve the recipient's stored locale and pass it into `getTranslations({ locale })` — this is mechanical but touches all 29 files.

**External dependency, not a code problem:** WhatsApp messages sent via Meta's Business API may require separately-approved templates per language (your KYC notes already mention Authentication-category template approval for OTP). If French/Pidgin WhatsApp variants need their own Meta approval, that's a submission-and-wait process outside this codebase — flagging it now so it isn't a surprise later, not blocking this spec.

## 8. Admin Dashboard Scope

"Everything, including admin" means the admin dashboard's own UI chrome — buttons, labels, table headers, form field labels, nav — gets translated like any other page. It does **not** mean admin-authored *content* (a tournament's title/description typed into a form) gets translated — that's dynamic content, covered by §9's rule, identical treatment to a player's community post.

## 9. User- and Admin-Authored Content — Untranslated

Tournament titles/descriptions, community posts and comments, exchange listing titles/descriptions, and any other free-text a person typed into the site are always shown exactly as authored, regardless of the viewer's selected language — the same convention as Twitter/Reddit. No translation API, no added cost or latency, no risk of gamer-slang being mistranslated. Machine-translating this content on the fly is a real, separate feature that can be scoped later if wanted; it is not part of this spec.

## 10. SEO

- Every page using `generateMetadata()` (per CLAUDE.md's existing SEO rules — tournament, match, player pages, etc.) gains an `alternates.languages` block pointing at the `en`/`fr`/`pcm` versions of that same page, so search engines index all three correctly instead of treating them as duplicate/unrelated content.
- `app/sitemap.ts` emits all three locale variants of every URL.
- `app/robots.ts` is unaffected (locale-neutral).
- Currency stays Naira (`₦`) formatted identically regardless of locale — only text strings translate, not number/currency formatting. (Explicit decision, to avoid ambiguity: this is not a currency-localization project.)

## 11. Data Model Changes

One migration: add `profiles.locale` (§5). No other schema changes — notification copy translation is a code-layer change (message catalogs), not a data-layer one.

## 12. Testing Strategy

- A unit test asserting all three message-catalog files have identical key sets (catches a missing translation before it ships as a blank string or English fallback bleeding into a French/Pidgin page).
- Middleware integration tests covering: unauthenticated `/dashboard` redirect preserves locale prefix; authenticated access to `/admin` works under all three locale prefixes; static asset/API routes are untouched by locale rewriting.
- A unit test per notification-copy builder confirming it resolves the recipient's stored locale (not a hardcoded default) and produces the correct-language string.
- `tsc`/`npm run build` clean, matching this repo's established convention for verifying routing/config-heavy work that doesn't lend itself to component tests.

## 13. Out of Scope

- Machine-translating user/admin-authored content (§9) — explicitly rejected for v1.
- Any language beyond `en`/`fr`/`pcm` — architecture supports adding one later; none built now.
- RTL layout support — not needed for any v1 language.
- Currency/number/date localization — Naira formatting is unchanged regardless of viewer locale.
- Getting WhatsApp template approval from Meta for non-English variants — an external operational step, not a code deliverable of this spec.
