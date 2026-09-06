# SentinelX Referral System — Design Spec

**Date:** 2026-08-16
**Status:** Approved → ready for implementation
**Routes:** `/dashboard/referrals` (new), `/signup?ref=[code]` (extend existing signup)
**Phase:** 3

---

## 1. Vision

Every SentinelX player becomes a recruiter. When someone new joins the platform using your link and competes in their first tournament, you earn SX Coins. The more you bring in, the more you earn — with milestone bonuses that scale up. This turns existing players into a growth engine.

**Key constraint:** Referral earnings are kept in a completely separate coin bucket from prize winnings and standard competition rewards. They appear under their own category in `sx_coin_transactions` (`category = 'referral_reward'`) and their own line in the wallet breakdown. They are never pooled with prize money.

---

## 2. How It Works — Player Perspective

1. Every player gets a permanent referral link: `sentinelxesports.com/signup?ref=[username]`
2. A friend clicks the link, creates their account
3. The friend registers and pays for their first tournament
4. The referrer receives **+250 SX Coins** immediately (= ₦125 equivalent)
5. Milestone bonuses stack on top as referral count grows

The referred player gets nothing on signup (keeps the onboarding simple). A "friend discount" mechanic may come in Phase 4 as a separate feature.

---

## 3. Referral Code

Use the player's username directly as the referral code. No separate `referral_code` column needed:

- Simple, memorable, already unique (DB `UNIQUE` constraint on `profiles.username`)
- Link format: `sentinelxesports.com/signup?ref=methio`
- No collision risk: if a username is changed, the old link stops working — acceptable (edge case; username changes are already limited to once-ever per spec `2026-08-16-player-profile-settings-design.md §6`)

If a future need arises for UUID-based codes (short links, tracking, etc.), migrate to a `referral_code` column at that time. For now, username = code.

---

## 4. Referral Tracking

### DB Schema

```sql
CREATE TABLE referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'converted', 'invalid')),
  converted_at    timestamptz,           -- set when first tournament paid
  coins_awarded   integer,               -- total coins given for this referral
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(referred_id)                    -- one referrer per referred player, ever
);
```

`UNIQUE(referred_id)` ensures a player can only be referred once, no matter how many times they try to sign up with different links. First referrer wins.

**RLS:**
```sql
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
-- Referrer can read their own referrals
CREATE POLICY "referrer reads own" ON referrals FOR SELECT
  USING (auth.uid() = referrer_id);
-- Referred player can read their own row
CREATE POLICY "referred reads own" ON referrals FOR SELECT
  USING (auth.uid() = referred_id);
-- Inserts and updates via service role only (signup action + conversion action)
```

### How the referral is captured at signup

When the signup form is submitted with a `?ref=methio` param:

1. Server Action resolves the referrer: `SELECT id FROM profiles WHERE username = 'methio' AND id != [new_user_id]`
2. If found AND no existing row in `referrals` for this `referred_id`: insert `referrals` row with `status = 'pending'`, `referrer_id = resolved.id`, `referred_id = new_user_id`
3. If not found / invalid / self-referral: silently skip — signup proceeds normally, no error shown to user

The `?ref` param is passed through the signup wizard. It is stored as Supabase auth metadata (`raw_user_meta_data->>'referral_code'`) so the `handle_new_user()` DB trigger (which creates the `profiles` row) can pass it along, and a separate trigger handles referral row insertion if preferred. Implementation choice for Claude Code — either approach is fine as long as the service role is used for the write.

### How a referral converts

When a player's tournament registration is confirmed (Paystack webhook fires or free-entry Server Action completes) **and it is their first confirmed registration ever**:

1. Check `tournament_registrations WHERE player_id = [player.id] AND payment_status = 'confirmed'` — count existing rows
2. If this is the first one (count was 0 before this confirmation): look up their referral row
3. If `referrals.status = 'pending'`: mark `status = 'converted'`, set `converted_at = now()`
4. Award coins to referrer (§5)
5. All of this runs via `createAdminClient()` — non-blocking (do not fail the payment confirmation if coin award fails — log error, continue)

---

## 5. Coin Awards

### Base reward

+250 coins to the referrer when a referral converts. Transaction:

```ts
// sx_coin_transactions row
{
  player_id:    referrer.id,
  type:         'earned',
  category:     'referral_reward',
  amount:       250,
  reference_id: referral.id,   // UUID of the referrals row
  note:         `Referral reward — ${referredPlayer.display_name} completed first registration`
}
```

### Milestone bonuses

After each conversion, count the referrer's total `status = 'converted'` referrals. If a milestone is hit, award an additional bonus:

| Referrals (total converted) | Bonus coins | ₦ equivalent | Note |
|---|---|---|---|
| 1 | +250 | ₦125 | "First recruit" |
| 5 | +500 | ₦250 | "Squad builder" |
| 10 | +1,000 | ₦500 | "Community champion" |
| 25 | +2,500 | ₦1,250 | "Sentinel Recruiter" |
| 50 | +5,000 | ₦2,500 | "Legend Recruiter" |

Milestone bonus transaction: same structure as above, `category = 'referral_milestone'`, separate `sx_coin_transactions` row.

Milestone bonuses are idempotent: check if a `referral_milestone` transaction already exists for this milestone threshold before inserting. Prevents double-award if the settlement function is ever re-run.

Also unlock corresponding achievement on milestone (insert into `player_achievements`):

| Milestone | Achievement slug |
|---|---|
| 1 | `referral_first` |
| 5 | `referral_squad` |
| 10 | `referral_champion` |
| 25 | `referral_sentinel` |
| 50 | `referral_legend` |

These achievements must be seeded in the `achievements` table with appropriate XP and coin values.

---

## 6. Dashboard — Referrals Page (`/dashboard/referrals`)

Full-page in the dashboard sidebar nav (already a stub page in the dashboard subpages spec).

```
┌──────────────────────────────────────────────────────────────────┐
│  REFERRALS                                                        │
│  ───────────────────────────────────────────────────────────────  │
│  Bring in a friend. Earn coins when they compete.                 │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Your referral link                                         │ │
│  │  sentinelxesports.com/signup?ref=methio                     │ │
│  │  [Copy link]  [Share on WhatsApp]                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  12 total referrals · 9 converted · +3,500 coins earned           │
│                                                                   │
│  NEXT MILESTONE                                                   │
│  ████████████░░░  25 referrals — +2,500 coins bonus               │
│  12 of 25 converted                                               │
│                                                                   │
│  REFERRED PLAYERS                                                 │
│  ────────────────────────────────────────────────────────────    │
│  [HexAvatar xs] Arole         ✅ Converted · Aug 15 · +250 coins  │
│  [HexAvatar xs] Drizzy        ✅ Converted · Aug 12 · +250 coins  │
│  [HexAvatar xs] Chisom        ⏳ Pending · Signed up, hasn't     │
│                                  entered a tournament yet          │
│  ...                                                              │
│                                                                   │
│  MILESTONE HISTORY                                                │
│  ✅ 1 referral — +250 coins bonus (Aug 12)                        │
│  ✅ 5 referrals — +500 coins bonus (Aug 14)                       │
│  ✅ 10 referrals — +1,000 coins bonus (Aug 15)                    │
└──────────────────────────────────────────────────────────────────┘
```

**Data required (Server Component, `Promise.all`):**

| Data | Query |
|---|---|
| All referrals | `referrals JOIN profiles (referred_id) WHERE referrer_id = user.id ORDER BY created_at DESC` |
| Total coins from referrals | `SUM(amount) FROM sx_coin_transactions WHERE player_id = user.id AND category IN ('referral_reward','referral_milestone')` |
| Next milestone | computed from converted count |
| Milestone history | `sx_coin_transactions WHERE player_id = user.id AND category = 'referral_milestone' ORDER BY created_at ASC` |

**"Share on WhatsApp" button:** `wa.me/?text=Come+compete+on+SentinelX+—+Nigeria's+home+of+mobile+esports!+Sign+up+here%3A+sentinelxesports.com%2Fsignup%3Fref%3Dmethio`

---

## 7. Wallet Integration

The locked "Referral Rewards" earnings card in `/dashboard/wallet` is now unlocked. It shows:

- **Total Earned** — same `SUM(amount)` query above
- **This Month** — same but filtered to current calendar month
- **Referrals** — count of converted referrals

The `ReferralEarningsCard` in the wallet sidebar (already specced in `2026-08-16-community-wallet-redesign-design.md §3`) can now show real data. No new component needed — just wire in the live numbers that were previously placeholders.

In `wallet_transactions` wallet history: referral rewards appear as `category = 'referral_reward'` and `category = 'referral_milestone'` rows in `sx_coin_transactions` — not in `wallet_transactions` (which is naira, not coins). They appear in the coin transaction history in the wallet's coins tab.

---

## 8. Attribution Rules (Edge Cases)

- **Self-referral:** referrer's own signup attempt with their own code → silently rejected (server-side: `referrer_id != referred_id` check)
- **Multiple signups from same link:** only the first signup after clicking a referral link is attributed. If the user signs up organically later, no attribution.
- **Referred player deletes their account:** referral row is cascade-deleted. If already converted, the referrer's coins are NOT clawed back — they were earned fairly.
- **Referred player never enters a tournament:** referral stays `pending` indefinitely. No coins awarded. No expiry (for now — Phase 4 may add 90-day expiry to reduce DB clutter).
- **Referrer account deleted:** cascade on `referrer_id` deletes all their referral rows. Referred players' accounts are not affected.

---

## 9. Admin Visibility

In the Admin Dashboard, under a new "Referrals" tab (simple table, no actions needed):

- Total referrals across platform
- Total conversions this month
- Total coins distributed via referrals
- Top 10 referrers by total conversions

This is read-only analytics — no admin actions needed on individual referrals. If fraud is suspected (fake account farms), Samuel flags the player manually and can ban via existing player-flag system.

---

## 10. Seeding Achievements

Migration must seed these 5 new achievement rows:

```sql
INSERT INTO achievements (slug, name, description, icon, category, xp_reward, coin_reward, share_to_feed)
VALUES
  ('referral_first',    'First Recruit',       'Refer your first player',           '🤝', 'social', 100,   250, true),
  ('referral_squad',    'Squad Builder',       'Refer 5 players who compete',       '👥', 'social', 300,   500, true),
  ('referral_champion', 'Community Champion',  'Refer 10 players who compete',      '🌍', 'social', 500,  1000, true),
  ('referral_sentinel', 'Sentinel Recruiter',  'Refer 25 players who compete',      '⚔️', 'social', 1000, 2500, true),
  ('referral_legend',   'Legend Recruiter',    'Refer 50 players — you are the platform', '🏆', 'social', 2000, 5000, true);
```

---

## 11. Out of Scope

- "Refer-a-friend and both get coins" (referred player reward) — Phase 4
- Multi-level referrals (referrer earns from their referral's referrals) — never (pyramid scheme risk)
- Paid referral campaigns (ad spend → referral bonus) — Phase 4+
- Referral link in email invites / WhatsApp group auto-send — Phase 4
- Referral expiry / time-limited referral windows — Phase 4
