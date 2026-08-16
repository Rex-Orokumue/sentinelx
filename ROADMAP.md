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
| — | ~~Community pillar v1 — per-game discussion feed, one-level replies, optional post images, admin moderation~~ (superseded, see note) | ✅ |

**★ v3.6 COMPLETE, superseded 2026-08-16.** This per-game discussion-board
version of `/community` (per-game feed, one-level replies, no reactions,
login-gated read) was replaced outright by the Phase 3 Social Feed — see
`docs/superpowers/specs/2026-08-15-phase3-social-feed-design.md` and
`docs/superpowers/plans/2026-08-15-phase3-social-feed.md`. `/community` is
now one shared public feed (not per-game, no login required to read), with
post types (manual/match_result/achievement/announcement), 4-emoji
reactions, threaded comments, weekly challenges, and Best Play of the Week
voting. The `community_posts`/`community_replies` schema this v1 row
described no longer exists — the 11 v1 posts / 19 replies (QA data) were
migrated into the new schema rather than dropped. v1's known deferred gaps
(no image pre-moderation, no orphaned-image cleanup on delete, no
real-time delivery, no nested replies, no editing, per-game only) are moot
now that it's retired.

## Phase 3 — Player Profile & Settings

| # | Task | Route | Status |
|---|------|-------|--------|
| — | Player Profile & Settings — season rank, XP bar, achievement showcase (rarity-sorted, locked achievements no longer leak name/description), community posts, `/dashboard/settings` (profile w/ one-time username change + compressed avatar upload, notification prefs, achievement-sharing prefs, account & security incl. delete account) | `/players/[username]`, `/dashboard/settings` | ✅ |

**★ Phase 3 Profile & Settings COMPLETE, 2026-08-16.** Gap-fill pass over the
already-built `/players/[username]` page (spec:
`docs/superpowers/specs/2026-08-16-player-profile-settings-design.md`, plan:
`docs/superpowers/plans/2026-08-16-player-profile-settings.md`). Also fixed
two real bugs found during the pass: the achievement query filtered to
`phase='phase2'` only (Phase 3 achievements never showed), and locked
achievements leaked their name/description via a tooltip. `/dashboard/profile`
now redirects to the new `/dashboard/settings`. Followers/following/likes
were discussed and explicitly deferred, not built.

## Phase 3 — Referral System (Coin Economy Redesign)

| # | Task | Route | Status |
|---|------|-------|--------|
| — | Referral system redesign — #22's flat ₦100-per-referral naira credit replaced with SX Coins: +250 coins on the referred player's first paid tournament entry, milestone bonuses at 5/10/25/50 converted referrals (matching `referral_first`…`referral_legend` achievements), `/admin/referrals` read-only analytics | `/dashboard/referrals`, `/dashboard/wallet`, `/admin/referrals` | ✅ |

**★ Referral Coin Economy Redesign COMPLETE, 2026-08-16.** Superseded #22's
naira model (spec: `docs/superpowers/specs/2026-08-16-referral-system-design.md`,
plan: `docs/superpowers/plans/2026-08-16-referral-system.md`). The existing
`referrals` table (019) was `ALTER`ed, not recreated — pre-existing rows were
backfilled `status = 'converted'`; their historical ₦100 credits stay
untouched in `wallet_transactions`. Conversion still fires on first *paid*
tournament entry (Paystack or the coin-discount free-entry path — that part
was already fixed post-#22, no longer at email verification); only the
reward itself changed, naira → coins + milestones. `sx_coin_transactions.source`
gained `referral_reward`/`referral_milestone`; `achievements.category` gained
`social` for the 5 new milestone achievements.

## Phase 3 — Betting/Wager Fixes, Money-Betting Removal, Share-Card Fixes

**Betting/wager fixes + coin-staked friendlies, DONE 2026-08-16** (plan:
`docs/superpowers/plans/2026-08-16-betting-fixes-and-share-cards.md`). Fixed
a real bug where coin wagering (`match_wagers`) closed its window before a
full-day match's play day had even begun — `wagerWindowOpen` had no
full-day carve-out, unlike the (now-removed) naira betting system, so every
currently-scheduled match in production read as unwagerable; confirmed live
via `execute_sql` before fixing. **Removed real-money betting entirely**
(`/betting`, `BettingPanel`, admin bet-lock/void tooling, `match_bets` table
+ `matches.betting_locked` column dropped — zero live rows, confirmed
before dropping) — coin wagering is now the only betting mechanism.
**Staked friendlies can now be denominated in coins as well as naira**
(`friendly_matches.stake_currency`, one currency per challenge, symmetric
stake; coin stakes settle instantly, no Paystack/webhook). Also fixed two
share-card bugs that dropped the sharer's avatar: community posts with an
uploaded image were bypassing the branded OG card entirely (raw photo used
as `og:image`, so the author's avatar never appeared — now the branded card
always renders and shows the post's photo as a thumbnail alongside the
avatar); and some real user avatars are large phone-camera PNGs with
embedded EXIF/ICC profiles that Satori's decoder silently fails on
(confirmed live: a 6.2MB avatar rendered blank) — image fetches for OG
cards now route through Supabase Storage's image-transform endpoint, which
re-encodes and strips the offending metadata.

## v4.0 — Scale

| # | Task | Status |
|---|------|--------|
| 21a | Multi-game support — admin game management, category taxonomy (football/fighting/shooter), per-category Rankings tabs + Hall of Fame awards, profile/dashboard stats fixed to stop blending stats across games | ✅ |
| 21b | Team/school/state leagues — teams of players representing a school/state, team-vs-team standings | ⬜ |
| 22 | Referral program — referral link, ₦100/referral credit, separate referral balance + withdrawal queue | ✅ |
| 23 | Rankings improvements — per-game wins breakdown, Sentinel Score/Hall of Fame scope audit | ✅ |
| 24 | Full-day match scheduling — date-only matches, auto-expire (cron), admin override | ✅ |
| 25 | WhatsApp fixture coordination audit — confirmed already built (#15+session fixture work); button copy aligned to spec | ✅ |
| — | Player notification system — in-app bell, 8 event types retrofitted (listings/withdrawals/referrals/results/referral credit), unblocks #26+#27 | ✅ |
| 26 | Friend system + friendly matches (free + staked) — friend requests, free challenges, staked matches with Paystack escrow, Match Room, Sentinel Score integration, staked balance + withdrawal queue | ✅ |
| 27 | Admin notifications — live-aggregation bell + sidebar badges + Overview StatCards over existing pending queues, no new table | ✅ |
| 28 | Player wallet system — unified wallet + ledger replacing the three withdrawal tables (prize/referral/friendly-stake), automatic credit on prize win/referral/staked-friendly win, one withdrawal queue at `/admin/wallet` | ✅ |
| 29 | Sponsored data support — per-tournament perk (text + WhatsApp), claim button for semi-finalists/finalists | ✅ |
| 30 | Match recording submission via WhatsApp — button on result submission alongside the existing screenshot/URL fields | ✅ |

---

## Follow-ups / tech debt

- ✅ **Homepage promo banner:** reusable admin-manageable banner (`/admin/banners`) —
  image + link + active toggle, independent of tournament publish status. Lets staff
  promote an upcoming tournament/season on the homepage before it opens for
  registration. First use: DLS 26 Championship Season 2 announcement (tournament
  created in `draft`, registration opens separately once ready).
- ✅ **Logged-in navigation rework:** fixed the mobile header horizontal-scroll (auth links overflowed the row; the added header Admin link tipped it over). Built the primary nav — mobile **bottom tab bar** (Compete/Watch/Community/Trade + Account, four pillars = product identity), desktop **avatar/account dropdown** (`AccountMenu`), admin **sidebar/drawer** (`AdminSidebar`, replaced the tab strip). Unbuilt pillars route to a shared `/coming-soon?feature=` page. Helpers in `lib/nav/`. Shipped as a hotfix commit first, then the full system. ⚠️ In-browser mobile-width visual check couldn't be completed (Chrome extension blocked JS/screenshots on localhost) — verified via tests/build/structure; recommend an eyeball on the deployed site.
- ✅ **Timezone display (app-wide):** shared WAT (`Africa/Lagos`, UTC+1 year-round) date/time helpers in `lib/format.ts` — `formatDateTime`/`formatDate`/`formatMonthYear` for display, and `toDateTimeLocal`/`fromDateTimeLocal` for the admin `datetime-local` scheduling round-trip. All formatter sites now route through them; admin enters WAT → stored as UTC instant → rendered back in WAT.
- ✅ **Automatic round scheduling:** admin sets a round start date + gap-between-rounds once on
  the bracket page; every round generated from then on (initial draw, group→knockout advance,
  each knockout round) is auto-stamped with that round's full-day date via
  `lib/tournaments/round-schedule.ts`, instead of requiring every match to be hand-dated. Computed
  from the count of distinct rounds already generated (never from any match's own `scheduled_at`),
  so a manually-overridden individual match can't skew later auto-scheduled rounds.

---

## Infrastructure — done

- ✅ Next.js 14 + TypeScript + Tailwind + shadcn/ui scaffold
- ✅ Supabase schema migration (13 tables, RLS, auth trigger) applied to live project
- ✅ Generated TypeScript types from live schema
- ✅ Supabase client/server helpers, Paystack lib stub
- ✅ Brand theming (violet) + logo assets
