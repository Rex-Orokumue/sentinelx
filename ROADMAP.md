# Sentinel X — Build Roadmap

Task tracker for the platform build. Grouped by version phase per CLAUDE.md scope.
Status legend: ⬜ pending · 🔨 in progress · ✅ done

---

## v1.0 — Run the next tournament

| # | Task | Route | Status |
|---|------|-------|--------|
| — | Home page | `/` | ✅ |
| 1 | Auth pages — login, signup, forgot password | `/(auth)/*` | ✅ |
| 2 | Tournament listing | `/tournaments` | ✅ |
| 3 | Tournament detail + Paystack registration (₦500) | `/tournaments/[slug]` | ✅ |
| 4 | Bracket page — groups + knockout, admin-confirmed updates | `/tournaments/[slug]/bracket` | ✅ |
| 5 | Match Centre — YouTube embed, result submission | `/matches/[id]` | ✅ |
| 6 | Leaderboard | `/rankings` | ✅ |
| 7 | Hall of Fame | `/hall-of-fame` | ✅ |
| 8 | Player Dashboard — fixtures, submit results, withdrawals | `/dashboard` | ✅ |
| 9 | Admin Dashboard — tournaments, result verification, flags | `/admin` | ✅ |

WhatsApp share buttons + mobile-first apply across all v1.0 pages.

## v2.0 — Profiles, TV, notifications

| # | Task | Route | Status |
|---|------|-------|--------|
| 10a | Stats & Sentinel Score engine — populate profile aggregates + score on result confirm; admin recompute button | (backend) | ✅ |
| 10b | Player profile page — stats, Sentinel Score, tier badge, leaderboard rank, achievements, match history | `/players/[username]` | ✅ |
| 11 | Sentinel X TV — live, highlights, finals, replays + curated `tv_videos` + admin CRUD | `/tv` | ✅ |
| 12 | WhatsApp Business notifications via Termii — registration/fixture/result/prize; pg_cron reminders; ready-to-activate | — | ✅ |

**★ v2.0 COMPLETE (#10a–#12).** Player profiles + Sentinel Score, Sentinel X TV, and WhatsApp notification infrastructure all shipped. (#12 is built ready-to-activate — no-ops until `TERMII_API_KEY` + Meta-approved templates are set; see the activation runbook in the #12 plan.)

## v3.0 — Exchange + KYC

| # | Task | Route | Status |
|---|------|-------|--------|
| 13a | Gaming Exchange catalog — browse/filter/detail, multi-image listings, My Listings, admin approve/remove | `/exchange` | ✅ |
| 13b | Gaming Exchange purchase + Zolarux escrow (buy flow, webhook state, My Orders/Sales) | `/exchange` | ✅ |
| 14 | KYC (BVN/NIN) + prize withdrawals via Paystack Transfer | — | ✅ |

**★ v3.0 COMPLETE (#13a–#14).** Gaming Exchange (catalog + escrow) and BVN KYC +
Paystack Transfer prize withdrawals all shipped.

## v3.5 — Admin gap fixes

| # | Task | Status |
|---|------|--------|
| 15 | Registration fields (display name, WhatsApp, club, IGN tag) + admin registrations list | ✅ |
| 16 | League table GF/GA columns + 3-tab platform leaderboard (Wins/Score/Goals) | ✅ |
| 17 | Admin player search (registrations, bracket, results) | ✅ |
| 18 | Tournament rules (Markdown) + registration agreement checkbox | ✅ |
| 19 | Dashboard fixture schedule — round label polish | ✅ |
| 20 | Live registration-deadline countdown | ✅ |

**★ v3.5 COMPLETE (#15–#20).** Six admin-flagged gaps closed: registration now
captures per-tournament player details verified by Samuel; league tables show
full goal splits; the leaderboard ranks by three separate metrics; admin search
works across registrations, brackets, and results; tournaments can carry
Markdown rules gated by a registration checkbox; and tournament pages show a
live countdown to the registration deadline.

## v3.6 — Community pillar

| # | Task | Status |
|---|------|--------|
| — | Community pillar v1 — per-game discussion feed, one-level replies, optional post images, admin moderation | ✅ |

**★ v3.6 COMPLETE.** The 🤝 Community pillar is live at `/community` — public
per-game feed, posts + one-level replies, optional post images, live-then-moderate
(no approval queue). Known deferred gaps (documented, not bugs): no image
pre-moderation, no orphaned-image cleanup on delete (same accepted gap as Gaming
Exchange listing images), no real-time delivery, no nested replies, no editing,
per-game only (not per-tournament).

## v4.0 — Scale

| # | Task | Status |
|---|------|--------|
| 21 | Multi-game support + team/school/state leagues | ⬜ |
| 22 | Referral program — referral link, ₦100/referral credit, separate referral balance + withdrawal queue | ✅ |
| 23 | Rankings improvements — per-game wins breakdown, Sentinel Score/Hall of Fame scope audit | ⬜ |
| 24 | Full-day match scheduling — date-only matches, auto-expire, admin override | ⬜ |
| 25 | WhatsApp fixture coordination audit — confirmed already built (#15+session fixture work); button copy aligned to spec | ✅ |
| 26 | Friend system + friendly matches (free + staked) | ⬜ |
| 27 | Admin notifications | ⬜ |

---

## Follow-ups / tech debt

- ✅ **Logged-in navigation rework:** fixed the mobile header horizontal-scroll (auth links overflowed the row; the added header Admin link tipped it over). Built the primary nav — mobile **bottom tab bar** (Compete/Watch/Community/Trade + Account, four pillars = product identity), desktop **avatar/account dropdown** (`AccountMenu`), admin **sidebar/drawer** (`AdminSidebar`, replaced the tab strip). Unbuilt pillars route to a shared `/coming-soon?feature=` page. Helpers in `lib/nav/`. Shipped as a hotfix commit first, then the full system. ⚠️ In-browser mobile-width visual check couldn't be completed (Chrome extension blocked JS/screenshots on localhost) — verified via tests/build/structure; recommend an eyeball on the deployed site.
- ✅ **Timezone display (app-wide):** shared WAT (`Africa/Lagos`, UTC+1 year-round) date/time helpers in `lib/format.ts` — `formatDateTime`/`formatDate`/`formatMonthYear` for display, and `toDateTimeLocal`/`fromDateTimeLocal` for the admin `datetime-local` scheduling round-trip. All formatter sites now route through them; admin enters WAT → stored as UTC instant → rendered back in WAT.

---

## Infrastructure — done

- ✅ Next.js 14 + TypeScript + Tailwind + shadcn/ui scaffold
- ✅ Supabase schema migration (13 tables, RLS, auth trigger) applied to live project
- ✅ Generated TypeScript types from live schema
- ✅ Supabase client/server helpers, Paystack lib stub
- ✅ Brand theming (violet) + logo assets
