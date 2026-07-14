# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Sentinel X?

Sentinel X is a **mobile esports platform** based in Nigeria. It is NOT a Dream League Soccer website — DLS is just the first game supported. The platform is built to support multiple games (EA FC Mobile, eFootball, PUBG Mobile, Free Fire, COD Mobile, Mortal Kombat) without rebuilding anything. Every system — tournaments, rankings, profiles — must be designed for multi-game from day one.

**Tagline:** "Nigeria's Home of Mobile Esports"
**Mission:** Build the most trusted and exciting mobile esports platform in Africa, where gamers compete, connect, and transact safely.

---

## Tech Stack

- **Framework:** Next.js 14 (App Router), TypeScript
- **Styling:** Tailwind CSS, shadcn/ui
- **Backend/DB:** Supabase (PostgreSQL, Auth, Storage, Realtime)
- **Payments:** Paystack (registration fees + prize withdrawals)
- **Video:** YouTube embed (live streams + replays — no native video hosting)
- **Notifications (v2):** WhatsApp Business API via Termii
- **Deployment:** Vercel

**Design rule:** Mobile-first always. Users are mobile gamers on phones.

---

## Development Commands

```bash
# Generate Supabase TypeScript types (requires SUPABASE_URL + SUPABASE_ANON_KEY)
npx supabase gen types typescript --project-id <project-id> > lib/supabase/types.ts
```

---

## Four Pillars — Every Feature Maps to One

| Pillar | What it does |
|--------|-------------|
| 🎮 Compete | Tournaments, brackets, matches |
| 📺 Watch | Sentinel X TV — live streams, replays, highlights |
| 🤝 Community | Posts, discussions, announcements |
| 🔒 Trade | Gaming Exchange powered by Zolarux escrow |

---

## Pages / Routes

| Route | Description |
|-------|-------------|
| `/` | Home — hero, live tournament, upcoming events, leaderboard, CTA |
| `/tournaments` | All tournaments — current, upcoming, past |
| `/tournaments/[slug]` | Tournament details — prize pool, format, bracket, registration |
| `/tournaments/[slug]/bracket` | Interactive bracket page |
| `/matches/[id]` | Match Centre — Player A vs B, live stream embed, replay, stats |
| `/tv` | Sentinel X TV — live, highlights, finals, replays |
| `/rankings` | Overall, season, game-specific leaderboards |
| `/players/[username]` | Player profile — stats, achievements, Sentinel Score, match history |
| `/hall-of-fame` | Season champions, MVP, Golden Boot, Best Goal |
| `/exchange` | Gaming Exchange (Zolarux integration) |
| `/community` | Posts, announcements, discussions |
| `/about` | Story, mission, partners, contact |
| `/dashboard` | Player dashboard — fixtures, stats, prize withdrawal, listings |
| `/admin` | Admin dashboard — protected, Admin/Moderator roles only |

---

## Database Schema (Supabase)

Full schema lives in `supabase/migrations/*.sql`; generated types in `lib/supabase/types.ts`.

---

## Tournament Logic — How Grouping Works

Brackets are NEVER generated before registration closes. When admin closes registration, the system auto-calculates groups:

| Players registered | Groups | Players per group | Who advances |
|-------------------|--------|-------------------|--------------|
| ≤ 8 | None — straight knockout | — | All |
| 9–16 | 2 | 4–8 | Top 2 per group |
| 17–32 | 4 | 4–8 | Top 2 per group |
| 33–64 | 8 | 4–8 | Top 2 per group |

Admin can override before publishing. After groups, it's single elimination knockout.

---

## Sentinel Score System

Every player starts at **70/100**. Range is 0–100.

**Points earned:**
- Complete a match (showed up + finished): +2
- Win with no dispute: +1
- Receive 5-star opponent rating: +2
- Receive 4-star opponent rating: +1

**Points lost:**
- No-show: −10
- Abandoned / rage-quit: −8
- Lost a dispute (false result): −15
- Receive 1–2 star rating: −2
- Admin flag (conduct): −5
- Admin flag (cheating): −20 + suspension

**Tiers displayed on profile:**
- 90–100 → 🟢 Elite
- 75–89 → 🔵 Trusted
- 60–74 → 🟡 Developing
- <60 → 🔴 At Risk

Every score change must be logged in `sentinel_score_events`.

---

## Match Result Verification Flow

1. Match is played
2. Winner submits screenshot + screen recording via Player Dashboard
3. Admin reviews submission in Admin Dashboard
4. Admin confirms or disputes result
5. Bracket / group table updates only after admin confirms
6. If disputed: admin reviews both players' recordings → rules → Sentinel Scores update accordingly

---

## Authentication

- Email + password via Supabase Auth. All auth mutations are **Server Actions** in `lib/auth/actions.ts` (login, signup, requestReset, resetPassword, signOut); validation uses shared `zod` schemas in `lib/auth/schema.ts`.
- Signup is a multi-step wizard; the username is passed as signup metadata and written into `profiles` by the `handle_new_user()` trigger (`raw_user_meta_data->>'username'` → `username` + `display_name`). Uniqueness is enforced by the DB `UNIQUE` constraint; a collision surfaces as Postgres `23505`, which the signup action maps to a friendly "username taken" message.
- **Email links use the `token_hash` + `verifyOtp` flow, NOT `exchangeCodeForSession`.** The route `app/auth/confirm/route.ts` reads `token_hash` + `type` from the query string and calls `supabase.auth.verifyOtp(...)`, which establishes the session via cookies entirely server-side. Do NOT reintroduce a `?code=`/`exchangeCodeForSession` callback — the verify/implicit flow returns tokens in the URL fragment, which a server route cannot read, and it breaks the password-reset flow.
- After verification, `resolveCallbackRedirect({ type, next })` decides the destination: `type=recovery` → `/reset-password`; otherwise the `next` param (default `/dashboard`).
- The Supabase **email templates** (Confirm signup, Reset password) must point at `/auth/confirm` with `token_hash={{ .TokenHash }}&type={{ .Type }}&next=…`. This is dashboard configuration, not code.
- `middleware.ts` refreshes the session on every request and guards `/dashboard` + `/admin` (redirect to `/login?next=…`); authenticated users are bounced away from `/login` and `/signup`.

## Payments — Paystack

- Registration fee: **₦500** per tournament
- Player pays at registration via Paystack inline/popup
- Store `paystack_reference` on `tournament_registrations`
- Verify payment via Paystack webhook before confirming registration
- Prize withdrawal: player requests from Dashboard → Paystack Transfer API → bank account
- KYC required before first withdrawal — **BVN identification is currently disabled** (most players are minors without a BVN, and Paystack's identification API has no NIN alternative). Verification is synchronous and payout-account-only: a Paystack-resolved bank account is enough to mark a player verified. Withdrawals are paid out manually by admin regardless, so this doesn't remove the check that actually matters. A guardian/NIN-based redesign is a known future need — see `lib/kyc/actions.ts` for what's disabled vs. what remains.

---

## Live Streaming

- Players stream to **Sentinel X YouTube channel** via YouTube Go Live or Streamlabs Mobile
- Admin pastes the YouTube URL into the match page in Admin Dashboard
- Frontend embeds it as `<iframe>` on the Match Centre page
- No native streaming infrastructure needed

---

## WhatsApp Integration

**v1.0 — Share buttons only (zero infrastructure):**
- "Share on WhatsApp" button on: tournament pages, match win, bracket updates
- Uses `https://wa.me/?text=` prefilled message with page URL
- "Join our WhatsApp Community" link pinned in site header

**v2.0 — Automated notifications via Termii:**
- Registration confirmation
- Fixture reminders (1 hour before match)
- Result confirmed
- Prize credited

---

## Admin Dashboard — What Samuel Can Do

- Create / edit / delete tournaments
- Close registration and generate brackets
- Assign matches to time slots
- Add YouTube stream URL to match pages
- Review and confirm match results
- Flag players (conduct / cheating)
- Approve / remove Gaming Exchange listings
- Manage disputes
- View all financials

**Roles:** `admin` (full access) | `moderator` (no financial actions, no player bans)

---

## SEO Rules

- All tournament, match, and player pages use Next.js `generateMetadata()`
- Open Graph tags on every page (for WhatsApp link previews)
- Tournament result pages stay live permanently after tournaments end
- Structured data (JSON-LD) on tournament and player pages

---

## v1.0 Scope — Build This First

These are the only things needed to run the next tournament:

1. Home page
2. Tournament listing page
3. Tournament detail + registration (Paystack)
4. Bracket page (interactive, updates as results confirmed)
5. Match Centre page (with YouTube embed + replay)
6. Leaderboard
7. Hall of Fame
8. Basic Admin Dashboard (Samuel only — tournament management, result verification)
9. Player Dashboard (register, pay, submit results, view fixtures)
10. WhatsApp share buttons on all pages
11. Mobile-first throughout

**Not in v1.0:** Player profiles, Sentinel Score display, Sentinel X TV, Gaming Exchange, notifications, multi-game support.

---

## v2.0 Scope
- Player profiles with full stats and Sentinel Score
- Sentinel X TV page
- Full YouTube streaming workflow
- WhatsApp Business API notifications (Termii)

## v3.0 Scope
- Gaming Exchange (Zolarux escrow integration)
- KYC for prize withdrawals

## v4.0 Scope
- Multi-game support
- Team leagues — schools, universities, state/national championships

---

## Key Rules When Coding

1. Always mobile-first — design for 375px width, scale up
2. Use Supabase Row Level Security (RLS) on every table
3. Never expose admin routes to non-admin users — check role server-side
4. All Paystack payment verification must happen server-side (webhook or API route) — never trust the client
5. Bracket updates only happen after admin confirms a result — never auto-update from player submissions
6. Every Sentinel Score change must write a row to `sentinel_score_events` — never update the score directly without logging
7. Tournament slug must be URL-safe and unique — used in all public URLs
8. Use Next.js Server Components by default; only use `"use client"` when you need interactivity
