# SentinelX SX Coins — Economy Extension Spec

**Date:** 2026-08-15
**Status:** Approved → ready for implementation
**Extends:** `docs/superpowers/specs/2026-08-05-phase2-economy-design.md`
**Phase:** 3 (entry-fee discount + community wagering)

---

## 1. Strategic Decision — No Coins → Naira Conversion

**Coins are permanently virtual. They cannot be converted to Naira.**

Rationale:
- Naira conversion would classify SentinelX as a Virtual Asset Service Provider under CBN guidelines — a licensing category the platform is not pursuing.
- Adding cash payouts to match wagering would trigger NLRC (National Lottery Regulatory Commission) gambling licensing requirements.
- The existing prize pool (Naira from tournament registration fees, paid out via Paystack Transfer) is already the real-money incentive. It is skill-based competition and legally clean.

Coins are a **parallel engagement economy** — they make the platform sticky and rewarding without crossing regulatory lines. This decision is permanent for Phase 3 and will only be revisited if SentinelX obtains appropriate fintech/gaming licenses in the future.

This decision must be clearly communicated to players in the store and wallet UI: **"SX Coins cannot be exchanged for cash. They are earned by competing and spent on the platform."**

---

## 2. Coin Value System

**1 SX Coin = ₦0.50**

The anchor rate: 1,000 coins = ₦500 (the cost of one tournament entry). All coin prices and earn amounts derive from this rate. The naira-equivalent must be shown alongside every coin price in the UI — in the store, on the entry discount widget, and in the wager widget. Players should never have to guess what their coins are worth.

| Reference point | Coins | Naira equivalent |
|----------------|-------|-----------------|
| One full tournament entry | 1,000 | ₦500 |
| Half-price tournament entry | 500 | ₦250 |
| Win a match | +100 | ₦50 earned |
| 1st place finish | +1,000 | ₦500 earned |
| 2nd place finish | +500 | ₦250 earned |
| Post boost (24h) | 200 | ₦100 |
| Min wager stake | 50 | ₦25 |
| Max wager stake | 2,000 | ₦1,000 |
| Store — entry cosmetic | ~100 | ₦50 |
| Store — premium cosmetic | ~2,000 | ₦1,000 |

**Earning rate is intentionally generous early on.** A first-time tournament winner earns 1,000 coins — enough for one free future entry. This is the hook. Veterans who've built up through daily play carry a real economic advantage. That's the retention mechanic.

This rate is fixed at the platform level. It is **not** adjustable per-player or per-tournament. It is hardcoded as a constant:
```ts
// lib/coins/value.ts
export const COINS_PER_NAIRA = 2        // 2 coins = ₦1
export const NAIRA_PER_COIN = 0.5       // 1 coin = ₦0.50
export const COINS_PER_ENTRY = 1000     // full tournament entry
export const COINS_HALF_ENTRY = 500     // half-price entry
```

---

## 3. Full Coin Economy — Earn & Spend

### 2.1 Earn Sources (all phases combined)

| Source | Coins | Phase |
|--------|-------|-------|
| Complete a match (showed up + finished) | +10 | 2 |
| Win a match | +90 | 2 |
| Daily login | +5 | 2 |
| 7-day login streak bonus | +50 | 2 |
| 30-day login streak bonus | +200 | 2 |
| Achievement unlock (varies per achievement) | +25 – +500 | 2 |
| Tournament placement — 1st | +1,000 | 2 |
| Tournament placement — 2nd | +500 | 2 |
| Tournament placement — 3rd | +250 | 2 |
| Weekly challenge: The Grind (play 3 matches) | +100 | 3 |
| Weekly challenge: Winner's Circle (win 2 matches) | +200 | 3 |
| Weekly challenge: Community Voice (post in feed) | +25 | 3 |
| Weekly challenge: Hype Man (react to 5 posts) | +15 | 3 |
| Community wagering — win a coin bet | varies | 3 |
| Best Play of the Week — winner | +500 | 3 |
| Best Play of the Week — runner-up | +200 | 3 |
| Post gets 10 reactions | +50 | 3 |
| Post gets 50 reactions | +150 | 3 |
| Referral milestone (Phase 3) | +250–+1,000 | 3 |

### 2.2 Spend Destinations

| Destination | Cost | Phase |
|-------------|------|-------|
| Cosmetics store (avatar borders, themes, username colours, bubble skins) | 100–2,000 | 2 |
| Tournament entry fee discount (see §3) | 500 coins = ₦250 off | 3 |
| Community wagering — stake on a match (see §4) | player-set stake | 3 |
| Boost a community post (pin to top of feed for 24h) | 200 coins | 3 |

---

## 4. Entry Fee Discount (Option B)

### Concept

At tournament registration, a player can choose to apply a coin discount. Two tiers:
- **Half price:** 500 coins = ₦250 off → player pays ₦250
- **Free entry:** 1,000 coins = ₦500 off → player pays ₦0 (skips Paystack entirely)

This is a promotional discount, not a currency conversion.

### Rules

- Discount applies to any tournament with an entry fee of ₦500 or more
- Maximum one discount tier per registration — cannot combine
- Coins deducted at the point of applying the discount, before Paystack checkout opens
- Free entry (1,000 coins): Paystack checkout is skipped entirely — registration is confirmed immediately after coin deduction
- If player abandons checkout after coins are deducted: coins are refunded automatically
- Free tournaments (₦0 entry): discount not applicable — no prompt shown

### UX Flow

```
┌────────────────────────────────────────────────────────────┐
│  REGISTER FOR TOURNAMENT                                   │
│  DLS Community Club #4                                     │
│  ─────────────────────────────────────────────────────     │
│  Entry fee:                                    ₦500        │
│                                                            │
│  🪙 Use SX Coins?              Your balance: 1,450 coins   │
│                                                            │
│  ◉  500 coins — Pay ₦250       (save ₦250)                 │
│  ○  1,000 coins — Free entry   (save ₦500)                 │
│  ○  No discount                                            │
│                                                            │
│  You pay:                                      ₦250        │
│                                                            │
│             [  Pay ₦250 with Paystack  ]                   │
└────────────────────────────────────────────────────────────┘
```

Tiers only shown if player has enough coins for them (balance ≥ 500 shows first option; balance ≥ 1,000 shows both). If balance < 500: coin section not shown.

Free entry path: "Pay ₦0 — Confirm Registration" button instead of Paystack. Server Action deducts 1,000 coins, marks registration as paid, skips Paystack entirely.
After applying: "Apply Discount" changes to "Remove Discount ✕", fee updates to ₦250.

### DB changes

Add a column to `tournament_registrations`:
```sql
ALTER TABLE tournament_registrations
  ADD COLUMN coins_used integer NOT NULL DEFAULT 0,
  ADD COLUMN coin_discount_naira integer NOT NULL DEFAULT 0;
```

When discount is applied: insert `sx_coin_transactions` row with `type = 'spent'`, `category = 'entry_discount'`, `amount = -500`, `reference_id = registration.id`.

Paystack checkout amount is set server-side to `entry_fee - coin_discount_naira`. Never trust client-side fee calculation.

---

## 5. Community Wagering (Option C)

### Concept

Before a confirmed match starts, players can stake SX Coins on the outcome. Winner takes the loser's stake. All in coins — no Naira involved anywhere in this flow. This is a loyalty programme mechanic, legally equivalent to staking points.

Only **registered SentinelX players** can place wagers. Only **confirmed scheduled matches** can be wagered on (must have both players confirmed and a `scheduled_at` time set).

### Rules

- Wager window: opens when match is created with both players confirmed, closes 15 minutes before `scheduled_at`
- Minimum stake: 50 coins
- Maximum stake: 2,000 coins per wager (caps exposure, prevents hoarding abuse)
- One wager per player per match (can change stake up until window closes)
- Players in the match (Player A or Player B) **cannot wager on their own match**
- When admin confirms the result: system distributes stake automatically
- If match result is disputed and overturned: wagers refunded to all bettors
- If match is cancelled/no-show: wagers refunded to all bettors

### Payout

Winner-takes-stake model (not a pool):
- Each bettor placed a stake on either Player A or Player B
- All stakes on the losing side are summed
- Distributed proportionally to bettors on the winning side (pro-rata based on their stake size)
- A 5% platform fee is deducted from winnings before distribution (platform keeps 5% of losing stakes in a `platform_coin_reserve` — used for future giveaways, events, best play prizes)

Example:
- 3 players bet 100 coins each on methio (total: 300 coins)
- 1 player bets 200 coins on Arole (total: 200 coins)
- methio wins
- Platform fee: 10 coins (5% of 200)
- Winning pool: 190 coins distributed pro-rata: each methio bettor gets ~63 coins on top of their 100 stake back

### DB Schema

```sql
CREATE TABLE match_wagers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  bettor_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pick_player_id uuid NOT NULL REFERENCES profiles(id),  -- who they bet on
  stake_coins   integer NOT NULL CHECK (stake_coins >= 50 AND stake_coins <= 2000),
  payout_coins  integer,          -- filled when result confirmed; null until then
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','won','lost','refunded')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id, bettor_id)    -- one wager per player per match
);

-- Platform coin reserve (5% fee pool)
CREATE TABLE platform_coin_reserve (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid REFERENCES matches(id),
  coins       integer NOT NULL,
  source      text NOT NULL DEFAULT 'wager_fee',
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**RLS:**
```sql
ALTER TABLE match_wagers ENABLE ROW LEVEL SECURITY;
-- Players can read all wagers (public odds visibility)
CREATE POLICY "read wagers" ON match_wagers FOR SELECT USING (true);
-- Players can insert/update their own wager
CREATE POLICY "manage own wager" ON match_wagers FOR ALL USING (auth.uid() = bettor_id);
-- Payout + status updates via service role only (admin result confirmation)
```

### Match wager settlement

When admin confirms a match result in `/admin/matches`, the existing Server Action gains an additional step:

```
1. Write match result (existing)
2. Create community feed post (Phase 3 social feed — existing)
3. Settle wagers (NEW):
   a. Sum all stakes on losing side
   b. Deduct 5% platform fee → insert platform_coin_reserve row
   c. Distribute remaining pro-rata to winning bettors
   d. Insert sx_coin_transactions rows for each bettor (won or lost)
   e. Update match_wagers.status and payout_coins for each row
   f. Update sx_coins.balance for each bettor
```

All of step 3 runs via `createAdminClient()` (service role) in a single async block. Non-blocking — if settlement fails, result confirmation is not rolled back (log the error, admin can manually settle).

### UX — Wager Widget on Match Centre page (`/matches/[id]`)

```
┌────────────────────────────────────────────────────────────┐
│  🪙  COMMUNITY WAGER                      Closes in 2h 15m │
│  ─────────────────────────────────────────────────────     │
│  [HexAvatar sm]  methio      vs     Arole  [HexAvatar sm]  │
│    640 coins wagered               380 coins wagered        │
│    (63% backing)                   (37% backing)            │
│                                                             │
│  Your balance: 1,450 coins                                  │
│  Stake: [  100  ] coins   on  [methio ▾]                   │
│                                                             │
│  Potential win: +62 coins                                   │
│             [  Place Wager  ]                               │
│                                                             │
│  12 players wagering · Your wager: none yet                │
└────────────────────────────────────────────────────────────┘
```

- Shows live aggregate stakes on each side (public)
- "Potential win" is estimated based on current pool — updates when new wagers come in (`"use client"` component)
- Wager window closed state: "Wagering is closed. Results pending." — shows current stakes read-only
- After result confirmed: shows "methio won! You won +62 coins 🎉" or "Arole won. You lost 100 coins."
- If player is one of the match participants: widget not shown (replaced with their match submission UI)

### UX — Wager history in wallet (`/dashboard/wallet/transactions`)

Wager transactions appear in the wallet transaction list with:
- Category icon: 🎲
- Description: "Wager — methio vs Arole" / "Wager Win — methio vs Arole"
- Amount: -100 coins (stake deducted) + separate +162 coins row (payout) if won

---

## 6. Boost a Community Post

Simple spend mechanic to gamify the feed.

- Cost: 200 coins
- Effect: post is pinned to top of the feed (below announcements) for 24 hours. After 24h it drops back to chronological position.
- Limit: one boost active per player at a time
- Available on any `manual` post the player authored

```sql
ALTER TABLE community_posts
  ADD COLUMN boosted_until timestamptz;
```

Feed query adds: `ORDER BY boosted_until DESC NULLS LAST, is_pinned DESC, created_at DESC`.

Coin transaction: `category = 'post_boost'`, `amount = -200`.

---

## 7. UI — Coin Balance Visibility

Everywhere a player sees their coin balance, add a small contextual note:

> "SX Coins are earned by competing and spent on the platform. They cannot be exchanged for cash."

Show this once as a dismissible tooltip on first visit to the store and wallet page. After dismissed: never show again (localStorage flag). Short, honest, pre-empts confusion.

---

## 8. Out of Scope (this spec)

- Coins → Naira conversion: permanently excluded (see §1)
- Gifting coins to other players: Phase 4+
- Coin leaderboard ("richest players") — Phase 4+
- Tournament prize pool funded by wager fees (platform reserve → prize pool): Phase 4+ decision
- Wagering on external matches (not SentinelX matches): never
