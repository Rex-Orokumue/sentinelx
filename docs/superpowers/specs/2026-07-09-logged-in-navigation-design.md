# Logged-in Navigation Rework — Design Spec

**Date:** 2026-07-09
**Status:** Approved design → ready for implementation plan
**Context:** Fixes a mobile horizontal-scroll regression and builds the platform's primary navigation.

---

## 1. Problem

`AuthNav` renders **Admin / Dashboard / Sign out** as always-visible inline links in the header, never collapsed on mobile. On a ~375px phone the logged-in header row (logo + wordmark + three auth links + hamburger) exceeds the viewport, so the whole page scrolls sideways. Adding the staff "Admin" link (commit `c1aae0c`) tipped it over.

Deeper issue: the logged-in area has **no real navigation system**. Players can only reach `/dashboard`; the four product pillars (Compete / Watch / Community / Trade) have no primary nav; the admin area uses a horizontal tab strip that scrolls awkwardly on mobile.

## 2. Approach

Build the platform's **primary navigation** around the four pillars, mobile-first:

- **Mobile:** a fixed **bottom tab bar** (the standard mobile-app pattern) with the four pillars + Account. Global — every visitor sees it, because the pillars *are* the product identity. This replaces the always-inline `AuthNav` on mobile, which is the overflow fix.
- **Desktop:** the existing top header, with inline auth links replaced by an **avatar/account dropdown**.
- **Admin:** a **left sidebar** on desktop, **drawer** on mobile — real operator pages only.

**Delivery is two commits** (do not mix): (1) a minimal overflow hotfix shipped immediately, then (2) the full nav system, which supersedes the hotfix's mobile handling.

## 3. Navigation model

| Surface | Mobile (`<640px`, Tailwind `sm`) | Desktop (`≥640px`) |
|---|---|---|
| Player / public | Bottom tab bar (fixed); top header = logo + WhatsApp CTA | Top header links + avatar/account dropdown |
| Admin (`/admin/*`) | Hamburger → left drawer; **bottom bar hidden here** | Persistent left sidebar |

**Decision A — bottom bar is global** (logged-in or not). The Account tab adapts: logged-out → Login, logged-in → the user's account.
**Decision B — bottom bar hidden on `/admin/*`** so admins get one nav surface, not two.
**Decision C — Rankings & Hall of Fame live under the Compete pillar**, not as tabs and not under Account — they're competition features. Surfaced as a small secondary link row at the top of `/tournaments`.

## 4. Player bottom tab bar (mobile)

Fixed to the viewport bottom, 5 equal-width tabs (icon + label), active state on the current section, iOS safe-area padding (`env(safe-area-inset-bottom)`). Page content gets bottom padding so nothing hides behind it. Hidden at `sm` and up, and hidden on `/admin/*`.

| Tab | Icon (lucide) | href | Active when |
|---|---|---|---|
| Compete | `Trophy` | `/tournaments` | pathname starts `/tournaments` |
| Watch | `Play` | `/coming-soon?feature=Watch` | pathname `/coming-soon` & feature=Watch |
| Community | `Users` | `/coming-soon?feature=Community` | pathname `/coming-soon` & feature=Community |
| Trade | `ShoppingBag` | `/coming-soon?feature=Trade` | pathname `/coming-soon` & feature=Trade |
| Account | avatar / `User` | logged-in → `/dashboard`, else `/login` | pathname starts `/dashboard` |

**Account tab avatar touch:** when logged in, the Account tab shows the user's **avatar image** (`profiles.avatar_url`), or **initials** derived from `display_name`/`username` if no avatar, instead of the generic `User` icon — signalling logged-in state and making the tab feel personal. Logged-out shows the `User` icon.

Active-state selection is a **pure helper** `isTabActive(tab, pathname, feature)` (unit-tested); the component supplies `pathname`/`feature` from `usePathname()`/`useSearchParams()`.

## 5. Compete secondary links

At the top of `/tournaments` (the Compete landing), add a light secondary link row — **Rankings** (`/rankings`) and **Hall of Fame** (`/hall-of-fame`) — as small text links above the tournament list, so competition standings are discoverable under their pillar without adding tabs. No other change to that page.

## 6. Desktop header + account dropdown

`AccountMenu` (client) replaces the inline `AuthNav` links in the header at `sm+`:

- **Logged in:** avatar button (image or initials) → dropdown: **My Profile** (→ `/players/[username]` once #10b ships; until then → `/dashboard`), **Dashboard**, **Admin** (staff only), **Sign out** (form → existing `signOut` action). Opens on click, closes on outside-click/Escape.
- **Logged out:** a single "Log in" button.

The public links (Tournaments, Rankings) + WhatsApp CTA stay in the desktop header as they are.

## 7. Admin sidebar / drawer

Replaces the horizontal `AdminNav` strip. Reuses `ADMIN_NAV` + `visibleNav(items, isAdmin)` — **real pages only:** Overview, Tournaments, Results, Withdrawals (Withdrawals admin-only). Grows as real admin pages ship (Players/Settings later — not built now).

- **Desktop (`sm+`):** persistent left sidebar; admin content sits in a right column (two-column flex under the admin header).
- **Mobile:** a hamburger in the admin header toggles a left **slide-in drawer** with the same items; tapping an item or the backdrop closes it. The global bottom bar is not rendered on `/admin/*`.

`AdminSidebar` is a client component (active state via `usePathname`, drawer open state via `useState`). The old `AdminNav.tsx` is removed/replaced.

## 8. Coming-soon page

`app/(public)/coming-soon/page.tsx` (server) reads `?feature=` and renders a branded, centered card: Sentinel X wordmark/logo, the feature name, an on-brand blurb, and a "Back to Compete" link (`/tournaments`).

Feature copy lives in a pure module `lib/nav/coming-soon.ts`:

```ts
export interface ComingSoonFeature { title: string; blurb: string }
export function resolveComingSoon(feature: string | undefined): ComingSoonFeature
```

Map (unknown/missing → generic fallback):
- **Watch** → "Watch — live streams, highlights, and match replays on Sentinel X TV. Coming soon."
- **Community** → "Community — posts, discussions, and announcements from the arena. Coming soon."
- **Trade** → "Trade — the Gaming Exchange for accounts, coins, and gear, secured by escrow. Coming soon."
- **fallback** → { title: "Coming soon", blurb: "This part of Sentinel X is on the way." }

`generateMetadata` sets the page title from the resolved feature. When a real section ships, change only that tab's `href` (e.g. `/coming-soon?feature=Watch` → `/tv`); this page and map stay untouched. Unit-tested via `resolveComingSoon`.

## 9. Session data for nav

A server helper `lib/nav/session.ts` → `getNavSession()` returns `{ isLoggedIn, isStaff, username, avatarUrl }` (Supabase server client + `getStaffContext` + a `profiles` read for `username, display_name, avatar_url`). The root layout (server) calls it once and passes the result to `AccountMenu` (desktop) and `BottomTabBar` (mobile). Initials fallback is a pure helper `initialsFrom(displayName, username)` (unit-tested).

## 10. Files

**Commit 1 — hotfix (no new components):**
- Modify `components/shared/SiteHeader.tsx`: wrap the inline `authNav` slot in `hidden sm:block` and also render `{authNav}` inside the existing mobile dropdown, so auth links leave the always-inline row on mobile and become reachable via the hamburger. Kills the horizontal scroll.

**Commit(s) 2+ — full system:**
- Create `lib/nav/coming-soon.ts` (+ test), `lib/nav/session.ts`, `lib/nav/tabs.ts` (`isTabActive`, `initialsFrom`, tab config; + test).
- Create `components/shared/BottomTabBar.tsx` (client), `components/shared/AccountMenu.tsx` (client), `components/shared/Avatar.tsx` (image-or-initials, shared by both).
- Create `app/(public)/coming-soon/page.tsx`.
- Create `components/admin/AdminSidebar.tsx` (client); modify `app/admin/layout.tsx` to the sidebar/drawer layout; remove `components/admin/AdminNav.tsx`.
- Modify `app/layout.tsx`: call `getNavSession()`, render `AccountMenu` in header (via `SiteHeader`) and `BottomTabBar`; add mobile bottom padding to `main` so content clears the fixed bar.
- Modify `components/shared/SiteHeader.tsx`: swap inline auth links for `AccountMenu` on desktop; drop the now-redundant mobile hamburger auth handling (bottom bar owns mobile nav).
- Modify `app/dashboard/page.tsx`: surface a **Sign out** control (mobile reachability, since auth leaves the mobile header).
- Modify `app/(public)/tournaments/page.tsx`: add the Rankings / Hall of Fame secondary link row.

## 11. Testing

Pure helpers carry unit tests (Vitest, repo convention): `resolveComingSoon` (each feature + fallback), `isTabActive` (each tab incl. coming-soon feature match + account/dashboard), `initialsFrom` (display name, username fallback, empty). Visual components verified by `npm run build` + a mobile-width check confirming **no horizontal overflow** on a logged-in page and that the bottom bar renders and the admin drawer opens.

## 12. Scope boundaries

**In scope:** the hotfix; bottom tab bar; account dropdown; admin sidebar/drawer; coming-soon page; Compete secondary links; session/nav helpers.
**Not in scope:** building the Watch/Community/Trade/Players/Settings pages themselves; the player profile page `/players/[username]` (that's #10b — the account dropdown/tab link to `/dashboard` until it exists, then a one-line swap to the profile route).
