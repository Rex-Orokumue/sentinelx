# SentinelX Dashboard Overhaul — Design Spec

**Date:** 2026-08-15  
**Status:** Approved → ready for implementation  
**File:** `app/(protected)/dashboard/page.tsx` and related components  

---

## 1. Vision

The dashboard is the first thing a logged-in player sees. It must feel like stepping into a **command centre** — not a webpage. The player should immediately know: who they are, where they stand, and what they need to do next. Every time they open it they should feel the pull to play.

Design reference: League of Legends client home, Valorant home screen — bold, dark, stat-heavy, with a single dominant action at all times.

**Primary goal:** Make upcoming fixtures impossible to miss.  
**Secondary goal:** Communicate progression, rank, and status at a glance.  
**Tone:** Elite, intense, personal. This is YOUR war room.

---

## 2. Layout — Section by Section

Mobile-first. 375px base. All sections are full-width stacked on mobile, arranged in the order below. Desktop (≥768px) gets a 2-column grid on sections 3–6 where noted.

---

### Section 1 — Hero Identity Panel

Full-width. Always first. No sidebar.

```
┌────────────────────────────────────────────────────────────┐
│  [Purple–black radial gradient background]                  │
│                                                             │
│  [HexAvatar lg]   WELCOME BACK,                            │
│                   REX                            [Tier badge]│
│                   🔥 7-day streak                           │
│                   ─────────────────                         │
│                   SX Score          Season Rank             │
│                   1,240             #12                     │
│                                                             │
│  ████████████░░░░░  620 XP to Elite                        │
└────────────────────────────────────────────────────────────┘
```

**Elements:**
- `HexAvatar` component — size `lg` (80px). Tier frame applied automatically. See hex avatar spec.
- Player's `display_name` (or `username`) in **Barlow Condensed, 32px, uppercase, white**.
- Membership tier badge (Recruit / Guardian / Elite / Sentinel / Legend) — styled chip, tier colour.
- Login streak: `🔥 X-day streak` — only shown if `login_streak >= 2`. Hidden if 0 or 1.
- Two stat pills side by side: **SX Score** (from `profiles.sx_score`) and **Season Rank** (player's current position in the active season leaderboard — `#N` or `Unranked`).
- XP progress bar: `profiles.xp` vs next tier threshold. Label: `"620 XP to Elite"` (or `"MAX — LEGEND"` if already Legend). Bar uses tier colour.
- Background: `radial-gradient(ellipse at top left, rgba(124,58,237,0.3), transparent 70%), #0B0B0F`. Purple glow emanates from behind the avatar.

---

### Section 2 — NEXT MATCH (the money card)

Full-width. Always second. This is the most important element on the page.

**State A — Upcoming match exists:**

```
┌────────────────────────────────────────────────────────────┐
│  ⚔  YOUR NEXT MATCH                        In 2h 34m      │
│  ─────────────────────────────────────────────────────     │
│  [HexAvatar sm]                  vs  [HexAvatar sm]        │
│  YOU                                  OPPONENT_NAME        │
│  ─────────────────────────────────────────────────────     │
│  DLS 26 Community Club #3 · Round of 16                    │
│  Sat 16 Aug · 8:00 PM WAT                                  │
│                                                             │
│              [  VIEW MATCH  ]                              │
└────────────────────────────────────────────────────────────┘
```

- Card background: `bg-sx-surface border border-sx-purple` with a `box-shadow: 0 0 24px rgba(124,58,237,0.25)` purple glow.
- Header row: `⚔ YOUR NEXT MATCH` left, countdown (`In 2h 34m` / `Tomorrow 8 PM` / `Today 8 PM`) right in **purple text**.
- Two HexAvatars (sm, 40px) side-by-side with "vs" between them. Player's own avatar on left, opponent on right.
- Tournament name + round below avatars.
- Date/time in WAT.
- `VIEW MATCH` button — full-width on mobile, centered on desktop. Primary purple button.
- If match is happening **now** (`scheduled_at` ≤ now and match is `live`): change header to `🔴 LIVE NOW`, countdown to `LIVE`, button to `ENTER MATCH` with a pulsing red dot.
- If match result has been played but not yet submitted: show `⚠ SUBMIT YOUR RESULT` header and a `SUBMIT RESULT` CTA instead.

**State B — No upcoming match:**

```
┌────────────────────────────────────────────────────────────┐
│  🎮  NO MATCH SCHEDULED                                    │
│  You have no upcoming fixtures.                             │
│  Enter a tournament to compete.                             │
│                                                             │
│              [  BROWSE TOURNAMENTS  ]                      │
└────────────────────────────────────────────────────────────┘
```

Same card, dimmer border (`border-sx-border`), CTA links to `/tournaments`.

**State C — Pending invitation:**

If player has a pending Masters/Champions Cup invitation, this card is REPLACED by the invitation banner (same position, same prominence):

```
┌────────────────────────────────────────────────────────────┐
│  🏆  YOU'VE BEEN INVITED TO MASTERS!       Expires in 36h  │
│  You ranked #5 in August. Entry fee: ₦500.                 │
│                                                             │
│         [  ACCEPT & PAY  ]    [  DECLINE  ]               │
└────────────────────────────────────────────────────────────┘
```

Gold border + glow for invitation state.

---

### Section 3 — Stats Row

4-stat grid. 2×2 on mobile, 4 columns on desktop (≥640px).

| Stat | Source | Icon |
|------|---------|------|
| **Win Rate** | `wins / total_matches * 100` | 🎯 |
| **Total Wins** | `profiles.wins` | 🏆 |
| **Goals Scored** | `profiles.goals_scored` | ⚽ |
| **SX Coins** | `sx_coins.balance` | 🪙 |

Each stat card:
- `bg-sx-surface rounded-xl p-4`
- Large number: **Barlow Condensed, 28px, white**
- Label: small, `text-sx-gray`
- Icon top-right corner, 20px, purple

---

### Section 4 — Season Standing

Full-width on mobile. Right column on desktop (paired with Section 5 on left).

```
┌────────────────────────────────────────────────┐
│  📅  SEASON 1 STANDING                         │
│  ─────────────────────────────────────────────  │
│  #12  Season Rank           340 pts             │
│                                                  │
│  ████████░░░░░  Top 16 = Masters invite         │
│  You need 160 more points to qualify            │
│                                                  │
│  This month: #4  ·  89 pts                      │
│  Top 16 this month = Masters invite             │
└────────────────────────────────────────────────┘
```

- Season rank from `getSeasonLeaderboard()` — player's position.
- Progress bar: position vs top-16 threshold. Turns green/gold when inside top 16.
- Monthly rank sub-section: current month leaderboard position + monthly points.
- "Top 16 = Masters invite" callout — shown only if player is NOT yet in top 16.
- If already in top 16: show `✅ YOU'RE IN THE TOP 16 — Masters invitation coming.` in gold.

---

### Section 5 — Progression & Rewards

Left column on desktop (paired with Section 4 on right). Full-width on mobile.

```
┌────────────────────────────────────────────────┐
│  ⚡  YOUR PROGRESS                              │
│  ─────────────────────────────────────────────  │
│  [Guardian badge]  Guardian                     │
│  ███████░░░░  3,240 / 5,000 XP to Elite        │
│                                                  │
│  🪙  1,450 coins     [  VISIT STORE  →  ]       │
│                                                  │
│  🔥 7-day streak  (+50 coins tomorrow)          │
│                                                  │
│  RECENT ACHIEVEMENTS                            │
│  🏆  Tournament Champion   +500 XP  +250 coins  │
│  👟  First Win             +100 XP  +50 coins   │
└────────────────────────────────────────────────┘
```

- Tier badge + name + XP bar.
- Coin balance with Store link.
- Login streak with next-milestone preview (`+50 coins tomorrow` on day 6, `+200 coins tomorrow` on day 29).
- Last 2 unlocked achievements. If none: `"Complete your first match to start earning achievements."`

---

### Section 6 — Recent Matches

Full-width. Below sections 3–5.

```
┌────────────────────────────────────────────────────────────┐
│  RECENT MATCHES                              [View All →]   │
│  ─────────────────────────────────────────────────────────  │
│  WIN   vs HIM          3–1    Community Club #2 · Aug 12   │
│  LOSS  vs Arole        0–2    Community Club #2 · Aug 10   │
│  WIN   vs methio       2–1    Community Club #1 · Aug 7    │
└────────────────────────────────────────────────────────────┘
```

- Last 5 matches.
- Win = left green pill, Loss = red pill.
- Opponent name (link to their profile), score, tournament, date.
- `View All →` links to `/players/[username]#match-history`.
- If no matches yet: `"Your match history will appear here after your first game."`

---

### Section 7 — Quick Actions

Full-width. Always last.

```
┌────────────────────────────────────────────────────────────┐
│  QUICK ACTIONS                                              │
│  ─────────────────────────────────────────────────────────  │
│  [🎮 Enter a Tournament]  [📤 Submit Result]               │
│  [💰 Withdraw Prize]      [⚙ Account Settings]            │
└────────────────────────────────────────────────────────────┘
```

- 2×2 grid of action tiles on mobile. 4-column on desktop.
- "Withdraw Prize" only shown if `wallet.balance > 0`.
- "Submit Result" only shown if player has a match in `scheduled` or `live` status.
- Each tile: icon + label, `bg-sx-surface hover:bg-sx-purple/20` transition.

---

## 3. Data Requirements

All data fetched server-side in `app/(protected)/dashboard/page.tsx`. Single `Promise.all`:

| Data | Query |
|------|-------|
| Player profile + stats | `profiles` — `sx_score`, `xp`, `membership_tier`, `login_streak`, `wins`, `total_matches`, `goals_scored`, `sentinel_tier` |
| Next scheduled match | `matches` WHERE `player_a_id = me OR player_b_id = me` AND `status IN ('scheduled','live')` ORDER BY `scheduled_at ASC` LIMIT 1 |
| Opponent profile | Join from next match's other player_id |
| Season standing | `getSeasonLeaderboard(admin, activeSeason.id)` — find player's rank |
| Monthly standing | `getMonthlyLeaderboard(admin, seasonId, currentMonth)` — find player's rank |
| Coin balance | `sx_coins` WHERE `player_id = me` |
| Recent achievements | `player_achievements` JOIN `achievements` WHERE `player_id = me` ORDER BY `unlocked_at DESC` LIMIT 2 |
| Recent matches | `matches` WHERE `player_a_id = me OR player_b_id = me` AND `status = 'completed'` ORDER BY `updated_at DESC` LIMIT 5 |
| Pending invitation | `tournament_invitations` WHERE `player_id = me` AND `status = 'pending'` AND `expires_at > now()` LIMIT 1 |
| Wallet balance | `wallets` WHERE `player_id = me` |

---

## 4. Component Structure

```
app/(protected)/dashboard/page.tsx        ← server component, fetches all data
  components/dashboard/
    HeroIdentityPanel.tsx                 ← Section 1
    NextMatchCard.tsx                     ← Section 2 (handles all 3 states)
    InvitationBanner.tsx                  ← Section 2 State C (used inside NextMatchCard)
    StatsRow.tsx                          ← Section 3
    SeasonStandingCard.tsx                ← Section 4
    ProgressCard.tsx                      ← Section 5
    RecentMatchesCard.tsx                 ← Section 6
    QuickActions.tsx                      ← Section 7
```

All are **Server Components** (no `"use client"`) except the countdown in `NextMatchCard` (the live countdown timer needs client-side JS — use a minimal `CountdownChip.tsx` client component that takes the `scheduledAt` ISO string as a prop and renders the countdown only; everything else in `NextMatchCard` stays server-rendered).

---

## 5. Design Tokens

Consistent with Phase 1 visual overhaul:

| Token | Value |
|-------|-------|
| Background | `#0B0B0F` |
| Surface | `#13131F` |
| Border | `#1E1E30` |
| Purple | `#7C3AED` |
| Purple glow | `rgba(124,58,237,0.25)` |
| Gold | `#F59E0B` (amber-500) |
| Red (live/loss) | `#EF4444` |
| Green (win) | `#22C55E` |
| Text — primary | `#FFFFFF` |
| Text — secondary | `#94A3B8` (slate-400) |
| Font — headlines | Barlow Condensed, Bold/Black |
| Font — body | Inter |

---

## 6. Wallet & Earnings Breakdown

The existing wallet section is moved to its own tab inside the dashboard (not the main view) or a dedicated `/dashboard/wallet` sub-page. It is NOT shown on the main dashboard landing — only the coin balance and prize balance are surfaced as stat pills. This keeps the hero experience clean and focused on match/competition rather than finances.

---

## 7. Out of Scope

- Real-time match events (WebSocket) — Phase 3
- Team fixtures (Phase 4)
- Social feed on dashboard (Phase 3)
- Community activity suggestions — Phase 3
