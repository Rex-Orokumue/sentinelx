# Unified Mobile Navigation — Design Spec

**Status:** Approved by product owner, ready for implementation plan.

## Problem

Phones (<640px) currently render two independent, overlapping navigation surfaces: `BottomTabBar` (a fixed bottom bar: Tournaments/TV/Community/Exchange pillar tabs + an Account tab/popup) and `SiteHeader`'s hamburger drawer (a right-side slide-out panel listing `NAVBAR_LINKS`: Home/Tournaments/Games/Leaderboards/Seasons/Exchange/Store/Community/About Us, plus a WhatsApp CTA and Login/Register). On `/admin/*` pages there's a *third* surface layered on top: `AdminSidebar` renders its own separate mobile "Menu" button and drawer (`ADMIN_NAV` items), while `SiteHeader`'s drawer keeps showing regular site links underneath — and there is no link back to the public site from within the admin drawer at all. The product owner wants one single, coherent mobile navigation surface.

## Decisions (confirmed with product owner)

1. **Shape:** a bottom sheet (slides up from the bottom edge), not a side-panel drawer — chosen after a visual side-by-side comparison; picked for feeling closer to a native mobile app menu. This codebase already has a bottom-sheet precedent to follow: `components/tv/VideoModal.tsx` (slide-up animation, rounded top corners, backdrop-click + Escape to close, body scroll-lock while open).
2. **One trigger, everywhere.** The hamburger button that already lives in `SiteHeader`'s sticky header stays in the same place on every page, including `/admin/*`, and now opens the one sheet. `AdminSidebar`'s own separate mobile trigger+drawer is removed. `AdminSidebar`'s **desktop** sidebar (`sm:` and up) is untouched — this is a phone-width-only consolidation.
3. **Admin content lives in the same sheet, not a separate one.** When a staff member (any page, not just `/admin/*`) opens the sheet, it shows an Admin section (today's `ADMIN_NAV` items, with notification badges and the Admin/Moderator role badge) above a Site section — so staff always has one tap back to the public site without a dead end, and one tap into admin tools from anywhere.
4. **`BottomTabBar` is deleted entirely**, not just visually merged — its Account/profile items (My Profile, Dashboard, Friendlies, Betting, Sign out/Login) move into the new sheet's Account section.

## Architecture

**One new component:** `components/shared/MobileNavSheet.tsx`. Structure, top to bottom:
1. **Admin section** — rendered only when `session.isStaff` is true, regardless of which page is currently open. Same items `ADMIN_NAV` already provides (filtered through the existing `visibleNav(ADMIN_NAV, isAdmin)` for moderator-vs-admin visibility), same notification badge counts, same role badge — relocated, not redesigned.
2. **Site section** — a merged, deduplicated list built from `NAVBAR_LINKS` ∪ `PILLAR_LINKS` (by href). This is a real gap being fixed, not just a merge: `NAVBAR_LINKS` alone doesn't include `/tv`, which today is only reachable via the bottom bar's pillar tabs — dropping the bottom bar without this merge would silently make Sentinel X TV unreachable from primary mobile nav. The merge is deduplicated because `Tournaments`, `Community`, and `Exchange` already appear in both lists today.
3. **Account section** — My Profile, Dashboard, Friendlies, Betting, Sign out when logged in; Login/Register when logged out. Unchanged from what `BottomTabBar`'s popup and `SiteHeader`'s drawer already show today, just combined into one place.
4. **WhatsApp CTA** — carried over unchanged from `SiteHeader`'s existing drawer.

**Removed entirely:** `components/shared/BottomTabBar.tsx`, `SiteHeader`'s current side-drawer JSX (the trigger button stays, its target changes), `AdminSidebar`'s mobile-only "Menu" button + drawer block (its desktop `<aside>` block is untouched).

## Data Flow

`NavSession` (`lib/nav/session.ts`) gains one field: `isAdmin: boolean`, sourced from `getStaffContext()`'s existing return value (`StaffContext.isAdmin` already exists, it's just not currently exposed on `NavSession`). The root layout (`app/layout.tsx`), which already builds one `navSession` per request for every page, additionally fetches `ADMIN_NAV` (via `visibleNav`) and admin notification badge counts — but only when `navSession.isStaff` is true, so a regular player's page load never pays that extra query. This mirrors the conditional-fetch pattern `BottomTabBar` already uses today for `session.isStaff`, just extended one step further into the root layout itself.

## Edge Cases

- **Logged-out visitor:** no Admin section, no Account section beyond Login/Register — identical to both surfaces' current behavior, just unified into one.
- **Moderator (staff, not admin):** Admin section is present but filtered by the existing `visibleNav(ADMIN_NAV, isAdmin)` — no behavior change, only relocation.
- **Sheet must close on navigation** — tapping any link closes the sheet before routing, matching the `onClick={() => setOpen(false)}` pattern all three surfaces being replaced already use.
- **Desktop/tablet unaffected** — the existing desktop header nav links and `AdminSidebar`'s desktop sidebar keep working exactly as they do today; this spec only touches `sm:hidden`/mobile rendering.

## Testing

This is a client-side interactive component with no business logic to unit-test in isolation — the meaningful piece to test is the merge-and-dedupe of `NAVBAR_LINKS`/`PILLAR_LINKS`, which should be a small, named, pure, tested helper (e.g. in `lib/nav/links.ts`) rather than inlined in the component. The rest gets the same verification convention every other UI task in this project has used: build + lint + manual DOM inspection against the deployed site, since true narrow-viewport rendering isn't reliable in this environment (documented limitation, see project memory).

## Out of Scope

- Any change to desktop/tablet navigation.
- Any change to what's IN `NAVBAR_LINKS`, `PILLAR_LINKS`, or `ADMIN_NAV` beyond the TV-inclusion fix above — this is a presentation consolidation, not an IA redesign of what exists.
- The footer's own link list (`FOOTER_SECTIONS`) — unaffected, still the one surface that lists every destination on every breakpoint.
