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
| 13 | Gaming Exchange — Zolarux escrow | `/exchange` | ⬜ |
| 14 | KYC (BVN/NIN) + prize withdrawals via Paystack Transfer | — | ⬜ |

## v4.0 — Scale

| # | Task | Status |
|---|------|--------|
| 15 | Multi-game support + team/school/state leagues | ⬜ |

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
