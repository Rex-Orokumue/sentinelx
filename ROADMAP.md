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
| 9 | Admin Dashboard — tournaments, result verification, flags | `/admin` | ⬜ |

WhatsApp share buttons + mobile-first apply across all v1.0 pages.

## v2.0 — Profiles, TV, notifications

| # | Task | Route | Status |
|---|------|-------|--------|
| 10 | Player profiles — stats, Sentinel Score, tier badge | `/players/[username]` | ⬜ |
| 11 | Sentinel X TV — live, highlights, replays | `/tv` | ⬜ |
| 12 | WhatsApp Business notifications via Termii | — | ⬜ |

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

- ⬜ **Timezone display (app-wide):** date/time formatters (`formatWhen`/`formatDate` in the dashboard, `scheduled_at` on the bracket page, etc.) render in the server's timezone (UTC on Vercel), not Nigerian local time (WAT, UTC+1). A 20:00 WAT match shows as 19:00. Fix once with a shared formatter that sets `{ timeZone: 'Africa/Lagos' }` (or formats client-side). Surfaced during #8 review.

---

## Infrastructure — done

- ✅ Next.js 14 + TypeScript + Tailwind + shadcn/ui scaffold
- ✅ Supabase schema migration (13 tables, RLS, auth trigger) applied to live project
- ✅ Generated TypeScript types from live schema
- ✅ Supabase client/server helpers, Paystack lib stub
- ✅ Brand theming (violet) + logo assets
