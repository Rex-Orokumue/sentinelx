# Footer & Navigation Data Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish translating the site-wide chrome that `2026-08-23-multi-language-support-infrastructure.md`'s Task 11 deliberately deferred — the shared `lib/nav/links.ts` data source (and its two consumers, `SiteHeader.tsx` and `MobileNavSheet.tsx`), plus `SiteFooter.tsx`'s independent link/copy data — so every visitor sees a fully translated header, mobile nav drawer, and footer on all three locales.

**Architecture:** Same `next-intl` message-catalog pattern already proven in the infrastructure plan. `lib/nav/links.ts`'s `NavLink`/`PillarLink` interfaces change from a literal `label: string` field to `labelKey: string`, resolved via `useTranslations('nav')` at render time in each consumer — this is the same href→key approach `SiteHeader.tsx` already used as a local stopgap in Task 11, now promoted to the shared data source so `MobileNavSheet.tsx` gets it too and `SiteHeader.tsx`'s temporary local mapping can be deleted. `SiteFooter.tsx` is a separate, unrelated data source (confirmed: `lib/nav/links.ts`'s own `FOOTER_SECTIONS` export has zero consumers anywhere in the codebase) and gets its own `footer.*` namespace.

**Tech Stack:** Next.js 14.2 App Router, `next-intl` (already installed).

**Spec:** `docs/superpowers/specs/2026-08-23-multi-language-support-design.md` §6 — this plan implements the remainder of the site-wide UI chrome. `docs/superpowers/plans/2026-08-23-multi-language-support-infrastructure.md` established the pattern this plan follows exactly.

## Global Constraints

- Locales: `en` (default), `fr`, `pcm` — same three, same order, everywhere.
- The message-catalog key-parity test (`lib/i18n/message-parity.test.ts`) already fails automatically if any locale's key set diverges — use it as the TDD gate for every catalog change in this plan: add the English key, run the test to see it fail for `fr`/`pcm`, then add both translations to make it pass.
- `npx tsc --noEmit -p .` and `npx vitest run` must stay clean after every task. UI/JSX changes are verified via clean `tsc`/`npm run build` plus a manual browser check across all three locales, matching this repo's established convention for routing/component-tree work (confirmed in the infrastructure plan's Task 11).
- Admin-dashboard nav labels (`adminNav.items`, sourced from `lib/admin/nav.ts`) are explicitly **out of scope** here — deferred to the admin-dashboard page-conversion follow-on. Do not touch `lib/admin/nav.ts` or the admin section inside `MobileNavSheet.tsx`.

---

### Task 1: Add `nav.tv`, `account`, `common`, and `footer` catalog namespaces

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `messages/pcm.json`

**Interfaces:**
- Produces: `nav.tv`; `account.{myProfile,dashboard,wallet,friendlies,signOut,login,register}`; `common.{menu,closeMenu,joinWhatsapp,admin,moderator}`; `footer.{tagline1,taglineHighlight,taglineRest,sectionPlatform,sectionSupport,sectionCompany,stayConnected,emailAddressLabel,emailPlaceholder,subscribe,subscribed,copyright,poweredBy}`; `footer.links.{tournaments,games,rankings,seasons,exchange,community,tv,hallOfFame,players,help,safety,howItWorks,contact,rules,about,terms,privacy,refundPolicy}` — Tasks 2–4 consume these exact keys.

- [x] **Step 1: Add the English keys, then run the parity test to confirm it fails for fr/pcm**

Add to `messages/en.json` (merge into the existing top-level object — add `"tv": "TV"` inside the existing `"nav"` block, and add these three new top-level blocks):

```json
"account": {
  "myProfile": "My Profile",
  "dashboard": "Dashboard",
  "wallet": "Wallet",
  "friendlies": "Friendlies",
  "signOut": "Sign out",
  "login": "Login",
  "register": "Register"
},
"common": {
  "siteName": "SentinelX",
  "viewAll": "View all",
  "menu": "Menu",
  "closeMenu": "Close menu",
  "joinWhatsapp": "Join WhatsApp Community",
  "admin": "Admin",
  "moderator": "Moderator"
},
"footer": {
  "tagline1": "One Guardian. Every Moment.",
  "taglineHighlight": "Where Gamers Unite.",
  "taglineRest": "Champions Rise.",
  "sectionPlatform": "Platform",
  "sectionSupport": "Support",
  "sectionCompany": "Company",
  "stayConnected": "Stay Connected",
  "emailAddressLabel": "Email address",
  "emailPlaceholder": "Enter your email",
  "subscribe": "Subscribe",
  "subscribed": "Sent!",
  "copyright": "© {year} SentinelX Esports. All rights reserved.",
  "poweredBy": "Powered by",
  "links": {
    "tournaments": "Tournaments",
    "games": "Games",
    "rankings": "Leaderboards",
    "seasons": "Seasons",
    "exchange": "Store (Exchange)",
    "community": "Community",
    "tv": "Sentinel X TV",
    "hallOfFame": "Hall of Fame",
    "players": "Players",
    "help": "Help Center",
    "safety": "Safety Tips",
    "howItWorks": "How It Works",
    "contact": "Contact Us",
    "rules": "Rules",
    "about": "About Us",
    "terms": "Terms of Service",
    "privacy": "Privacy Policy",
    "refundPolicy": "Refund Policy"
  }
}
```

(Note `"common"` already exists with `siteName`/`viewAll` from the infrastructure plan — merge the three new keys into that existing block rather than duplicating it. Note `"nav"` already exists too — just add `"tv": "TV"` alongside its existing keys.)

Run: `npx vitest run lib/i18n/message-parity.test.ts`
Expected: FAIL — `fr.json`/`pcm.json` don't have these keys yet.

- [x] **Step 2: Add the French translations**

```json
"account": {
  "myProfile": "Mon profil",
  "dashboard": "Tableau de bord",
  "wallet": "Portefeuille",
  "friendlies": "Matchs amicaux",
  "signOut": "Se déconnecter",
  "login": "Connexion",
  "register": "S'inscrire"
},
"common": {
  "siteName": "SentinelX",
  "viewAll": "Voir tout",
  "menu": "Menu",
  "closeMenu": "Fermer le menu",
  "joinWhatsapp": "Rejoindre la communauté WhatsApp",
  "admin": "Administrateur",
  "moderator": "Modérateur"
},
"footer": {
  "tagline1": "Un gardien. Chaque instant.",
  "taglineHighlight": "Où les gamers s'unissent.",
  "taglineRest": "Les champions s'élèvent.",
  "sectionPlatform": "Plateforme",
  "sectionSupport": "Assistance",
  "sectionCompany": "Entreprise",
  "stayConnected": "Restez connecté",
  "emailAddressLabel": "Adresse e-mail",
  "emailPlaceholder": "Entrez votre e-mail",
  "subscribe": "S'abonner",
  "subscribed": "Envoyé !",
  "copyright": "© {year} SentinelX Esports. Tous droits réservés.",
  "poweredBy": "Propulsé par",
  "links": {
    "tournaments": "Tournois",
    "games": "Jeux",
    "rankings": "Classements",
    "seasons": "Saisons",
    "exchange": "Boutique (Échange)",
    "community": "Communauté",
    "tv": "Sentinel X TV",
    "hallOfFame": "Temple de la renommée",
    "players": "Joueurs",
    "help": "Centre d'aide",
    "safety": "Conseils de sécurité",
    "howItWorks": "Comment ça marche",
    "contact": "Nous contacter",
    "rules": "Règles",
    "about": "À propos",
    "terms": "Conditions d'utilisation",
    "privacy": "Politique de confidentialité",
    "refundPolicy": "Politique de remboursement"
  }
}
```

Add `"tv": "TV"` to `fr.json`'s existing `nav` block.

- [x] **Step 3: Add the Pidgin translations**

```json
"account": {
  "myProfile": "My Profile",
  "dashboard": "Dashboard",
  "wallet": "Wallet",
  "friendlies": "Friendlies",
  "signOut": "Comot",
  "login": "Login",
  "register": "Register"
},
"common": {
  "siteName": "SentinelX",
  "viewAll": "See all",
  "menu": "Menu",
  "closeMenu": "Close menu",
  "joinWhatsapp": "Join WhatsApp Community",
  "admin": "Admin",
  "moderator": "Moderator"
},
"footer": {
  "tagline1": "One Guardian. Every Moment.",
  "taglineHighlight": "Where Gamers Dey Unite.",
  "taglineRest": "Champions Dey Rise.",
  "sectionPlatform": "Platform",
  "sectionSupport": "Support",
  "sectionCompany": "Company",
  "stayConnected": "Stay Connected",
  "emailAddressLabel": "Email address",
  "emailPlaceholder": "Put your email",
  "subscribe": "Subscribe",
  "subscribed": "Don send!",
  "copyright": "© {year} SentinelX Esports. All rights reserved.",
  "poweredBy": "Powered by",
  "links": {
    "tournaments": "Tournaments",
    "games": "Games",
    "rankings": "Leaderboard",
    "seasons": "Seasons",
    "exchange": "Store (Exchange)",
    "community": "Community",
    "tv": "Sentinel X TV",
    "hallOfFame": "Hall of Fame",
    "players": "Players",
    "help": "Help Center",
    "safety": "Safety Tips",
    "howItWorks": "How E Dey Work",
    "contact": "Contact Us",
    "rules": "Rules",
    "about": "About Us",
    "terms": "Terms of Service",
    "privacy": "Privacy Policy",
    "refundPolicy": "Refund Policy"
  }
}
```

Add `"tv": "TV"` to `pcm.json`'s existing `nav` block.

- [x] **Step 4: Run the parity test to confirm it passes**

Run: `npx vitest run lib/i18n/message-parity.test.ts`
Expected: PASS.

- [x] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors (these are pure JSON additions, no code consumes them yet).

- [x] **Step 6: Commit**

```bash
git add messages/
git commit -m "feat(i18n): add nav.tv, account, common, and footer message catalog namespaces"
```

---

### Task 2: Convert `lib/nav/links.ts` to translation keys, simplify `SiteHeader.tsx`

**Files:**
- Modify: `lib/nav/links.ts`, `components/shared/SiteHeader.tsx`

**Interfaces:**
- Produces: `NavLink.labelKey: string` (was `label: string`) — Task 3's `MobileNavSheet.tsx` conversion consumes this same field.

- [x] **Step 1: Convert `lib/nav/links.ts`**

Replace every `label:` with `labelKey:`, and every literal English string value with its `nav.*` key name (matching Task 1's catalog and the existing keys from the infrastructure plan: `home, tournaments, games, rankings, seasons, exchange, store, community, about, tv`):

```ts
export interface NavLink {
  href: string
  labelKey: string
}

export interface PillarLink extends NavLink {
  // Icon lookup key for the mobile bottom bar.
  key: string
}

// The four product pillars (CLAUDE.md). These are the mobile bottom-bar tabs
// and lead the desktop header. Labels here are the ONLY labels for these
// destinations — previously the header said "Store"/"Tournaments" while the
// bottom bar said "Trade"/"Compete" for the same pages.
export const PILLAR_LINKS: PillarLink[] = [
  { key: 'compete', href: '/tournaments', labelKey: 'tournaments' },
  { key: 'watch', href: '/tv', labelKey: 'tv' },
  { key: 'community', href: '/community', labelKey: 'community' },
  { key: 'trade', href: '/exchange', labelKey: 'exchange' },
]

// Secondary destinations that earn a slot in the desktop header.
export const SECONDARY_LINKS: NavLink[] = [
  { href: '/games', labelKey: 'games' },
  { href: '/rankings', labelKey: 'rankings' },
  { href: '/seasons/season-1', labelKey: 'seasons' },
  { href: '/about', labelKey: 'about' },
]

// Reachable from the footer only — too many for the header, and the mobile
// bottom bar is capped at the four pillars + Account.
export const FOOTER_ONLY_LINKS: NavLink[] = [
  { href: '/players', labelKey: 'players' },
  { href: '/hall-of-fame', labelKey: 'hallOfFame' },
]

// Desktop header, in order. The logo is the Home link, so '/' is not repeated.
export const HEADER_LINKS: NavLink[] = [...PILLAR_LINKS, ...SECONDARY_LINKS]

export const NAVBAR_LINKS: NavLink[] = [
  { href: '/', labelKey: 'home' },
  { href: '/tournaments', labelKey: 'tournaments' },
  { href: '/games', labelKey: 'games' },
  { href: '/rankings', labelKey: 'rankings' },
  { href: '/seasons/season-1', labelKey: 'seasons' },
  { href: '/exchange', labelKey: 'exchange' },
  { href: '/store', labelKey: 'store' },
  { href: '/community', labelKey: 'community' },
  { href: '/about', labelKey: 'about' },
]

// The footer is a separate, independent data source (components/shared/SiteFooter.tsx)
// and does not consume this export — kept only as a pre-existing structural
// reference; not rendered anywhere.
export const FOOTER_SECTIONS: { heading: string; links: NavLink[] }[] = [
  { heading: 'Compete', links: [PILLAR_LINKS[0], SECONDARY_LINKS[1], SECONDARY_LINKS[2], FOOTER_ONLY_LINKS[1]] },
  { heading: 'Explore', links: [PILLAR_LINKS[1], PILLAR_LINKS[2], PILLAR_LINKS[3]] },
  { heading: 'More', links: [SECONDARY_LINKS[0], FOOTER_ONLY_LINKS[0], SECONDARY_LINKS[3]] },
]

export function mergeNavLinks(...lists: NavLink[][]): NavLink[] {
  const seen = new Set<string>()
  const merged: NavLink[] = []
  for (const list of lists) {
    for (const link of list) {
      if (seen.has(link.href)) continue
      seen.add(link.href)
      merged.push(link)
    }
  }
  return merged
}

export const SHEET_SITE_LINKS: NavLink[] = mergeNavLinks(NAVBAR_LINKS, PILLAR_LINKS)
```

(All existing file-level comments not shown above are unchanged — keep them as they are in the current file, only the `label`→`labelKey` fields and values change.)

- [x] **Step 2: Simplify `SiteHeader.tsx`**

Remove the Task-11 stopgap `NAV_LABEL_KEYS` local lookup entirely, and read `item.labelKey` directly:

```tsx
// Remove this block (no longer needed — lib/nav/links.ts now carries the key directly):
// const NAV_LABEL_KEYS: Record<string, string> = { ... }
```

Change the nav map's rendered label from:
```tsx
{t(NAV_LABEL_KEYS[item.href] ?? 'tournaments')}
```
to:
```tsx
{t(item.labelKey)}
```

- [x] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors. (If `MobileNavSheet.tsx` still reads `item.label` at this point, it will fail — that's expected and fixed in Task 3, which must land in the same PR/session before this is truly green. Run `npx tsc --noEmit -p .` again after Task 3 to confirm the full set is clean.)

- [x] **Step 4: Commit**

```bash
git add lib/nav/links.ts components/shared/SiteHeader.tsx
git commit -m "feat(i18n): convert lib/nav/links.ts to translation keys, simplify SiteHeader"
```

---

### Task 3: Convert `MobileNavSheet.tsx`

**Files:**
- Modify: `components/shared/MobileNavSheet.tsx`

**Interfaces:**
- Consumes: `item.labelKey` (Task 2), `account.*`/`common.*`/`nav.*` catalog keys (Task 1)

- [x] **Step 1: Add translation hooks and convert every string**

Add near the top of the component body (`MobileNavSheet` function):
```tsx
const tNav = useTranslations('nav')
const tAccount = useTranslations('account')
const tCommon = useTranslations('common')
```
And the import:
```tsx
import { useTranslations } from 'next-intl'
```

Apply these exact replacements (admin section — `adminNav.items`' own `item.label` and the `isAdmin ? 'Admin' : 'Moderator'` line stays partially in scope: the **badge text** `'Admin'`/`'Moderator'` translates via `tCommon`, but `item.label` from `adminNav.items` does **not** — that's `lib/admin/nav.ts`, explicitly out of scope per this plan's Global Constraints):

| Current | Replacement |
|---|---|
| `<span className="font-display text-lg font-bold uppercase tracking-wide text-white">Menu</span>` | `{tCommon('menu')}` |
| `aria-label="Close menu"` | `aria-label={tCommon('closeMenu')}` |
| `{adminNav.isAdmin ? 'Admin' : 'Moderator'}` | `{adminNav.isAdmin ? tCommon('admin') : tCommon('moderator')}` |
| `{item.label}` inside the `SHEET_SITE_LINKS.map(...)` block | `{tNav(item.labelKey)}` |
| `My Profile` | `{tAccount('myProfile')}` |
| `Dashboard` (the account-section one, not admin) | `{tAccount('dashboard')}` |
| `Wallet` | `{tAccount('wallet')}` |
| `Friendlies` | `{tAccount('friendlies')}` |
| `Sign out` | `{tAccount('signOut')}` |
| `Login` | `{tAccount('login')}` |
| `Register` | `{tAccount('register')}` |
| `<span>Join WhatsApp Community</span>` | `<span>{tCommon('joinWhatsapp')}</span>` |

Read the file's current exact JSX before editing (it was already read in full during this plan's research — match its exact structure) rather than guessing indentation/quoting.

- [x] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors — this also confirms Task 2's Step 3 deferred check now passes.

- [x] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [x] **Step 4: Commit**

```bash
git add components/shared/MobileNavSheet.tsx
git commit -m "feat(i18n): translate MobileNavSheet (site links, account section, admin badge)"
```

---

### Task 4: Convert `SiteFooter.tsx`

**Files:**
- Modify: `components/shared/SiteFooter.tsx`

**Interfaces:**
- Consumes: `footer.*` catalog keys (Task 1)

- [x] **Step 1: Convert the link-data arrays to keys**

```tsx
const LEGAL_LINKS: { href: string; labelKey: string }[] = [
  { href: '/terms', labelKey: 'terms' },
  { href: '/privacy', labelKey: 'privacy' },
  { href: '/help', labelKey: 'help' },
  { href: '/contact', labelKey: 'contact' },
]

const EXPANDED_SECTIONS: { headingKey: string; links: { href: string; labelKey: string }[] }[] = [
  {
    headingKey: 'sectionPlatform',
    links: [
      { href: '/tournaments', labelKey: 'tournaments' },
      { href: '/games', labelKey: 'games' },
      { href: '/rankings', labelKey: 'rankings' },
      { href: '/seasons/season-1', labelKey: 'seasons' },
      { href: '/exchange', labelKey: 'exchange' },
      { href: '/community', labelKey: 'community' },
      { href: '/tv', labelKey: 'tv' },
      { href: '/hall-of-fame', labelKey: 'hallOfFame' },
      { href: '/players', labelKey: 'players' },
    ],
  },
  {
    headingKey: 'sectionSupport',
    links: [
      { href: '/help', labelKey: 'help' },
      { href: '/safety', labelKey: 'safety' },
      { href: '/how-it-works', labelKey: 'howItWorks' },
      { href: '/contact', labelKey: 'contact' },
      { href: '/rules', labelKey: 'rules' },
    ],
  },
  {
    headingKey: 'sectionCompany',
    links: [
      { href: '/about', labelKey: 'about' },
      { href: '/terms', labelKey: 'terms' },
      { href: '/privacy', labelKey: 'privacy' },
      { href: '/refund-policy', labelKey: 'refundPolicy' },
    ],
  },
]
```

- [x] **Step 2: Add the translation hook and update every render site**

Add near the top of `SiteFooter`:
```tsx
const t = useTranslations('footer')
```
And the import:
```tsx
import { useTranslations } from 'next-intl'
```

Apply these replacements:

| Current | Replacement |
|---|---|
| `<p className="mt-3 text-sm font-semibold text-white">One Guardian. Every Moment.</p>` (both occurrences — simple and expanded variants) | `<p className="mt-3 text-sm font-semibold text-white">{t('tagline1')}</p>` |
| `<span className="text-sx-purple-text">Where Gamers Unite.</span> Champions Rise.` | `<span className="text-sx-purple-text">{t('taglineHighlight')}</span> {t('taglineRest')}` |
| `{section.heading}` (in `EXPANDED_SECTIONS.map`) | `{t(section.headingKey)}` |
| `{link.label}` (in the section links map) | `{t(\`links.${link.labelKey}\`)}` |
| `Stay Connected` | `{t('stayConnected')}` |
| `Email address` (sr-only label) | `{t('emailAddressLabel')}` |
| `placeholder="Enter your email"` | `` placeholder={t('emailPlaceholder')} `` |
| `{sent ? 'Sent!' : 'Subscribe'}` | `{sent ? t('subscribed') : t('subscribe')}` |
| `{l.label}` (in `LEGAL_LINKS.map`) | `{t(\`links.${l.labelKey}\`)}` |
| `` © {year} SentinelX Esports. All rights reserved. `` (both occurrences) | `{t('copyright', { year })}` |
| `Powered by <span className="font-bold text-white">ZOLARUX</span>` | `{t('poweredBy')} <span className="font-bold text-white">ZOLARUX</span>` |

`NewsletterForm` is a separate function component — it needs its own `useTranslations('footer')` call (hooks can't cross component boundaries); pass `t` down as a prop instead, since it's a small trivial component and threading one extra prop is simpler than a second `useTranslations` call: add `t: ReturnType<typeof useTranslations>` to `NewsletterForm`'s props and pass `t={t}` from `SiteFooter`.

- [x] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [x] **Step 4: Build**

Run: `npm run build`
Expected: clean.

- [x] **Step 5: Full test suite**

Run: `npx vitest run`
Expected: all pass.

- [x] **Step 6: Commit**

```bash
git add components/shared/SiteFooter.tsx
git commit -m "feat(i18n): translate SiteFooter (both variants, newsletter form, copyright)"
```

---

### Task 5: Manual verification across all three locales

- [x] **Step 1: Start the dev server and check the header**

Run: `npm run dev`. Visit `/`, `/fr`, `/pcm` — confirm the header nav labels are correct on each (this re-confirms Task 11's existing behavior still works after Task 2's refactor).

- [x] **Step 2: Check the mobile nav sheet**

Resize the browser (or use DevTools device emulation) to a mobile width, open the hamburger menu on each locale, and confirm: "Menu" title, Admin/Moderator badge (if logged in as staff), Site section link labels, Account section labels, and the WhatsApp CTA are all translated correctly. Confirm the Admin section's own item labels are unchanged (still English) — expected, out of scope.

- [x] **Step 3: Check the footer**

Visit a "simple" footer page (e.g. `/`) and an "expanded" footer page (e.g. `/games`, `/about`, `/community`, or `/exchange`) on each locale. Confirm all headings, links, the newsletter form, and the copyright line are translated. Confirm the copyright year interpolates correctly (not a literal `{year}`).

- [x] **Step 4: Final verification**

Run: `npx tsc --noEmit -p .` && `npx vitest run` && `npm run build` — all clean.

## Final Verification

- [x] `npx tsc --noEmit -p .` — clean
- [x] `npx vitest run` — all tests pass, including `lib/i18n/message-parity.test.ts`
- [x] `npm run build` — clean
- [x] Manual: header, mobile nav sheet, and both footer variants are fully translated on `/`, `/fr`, `/pcm`
