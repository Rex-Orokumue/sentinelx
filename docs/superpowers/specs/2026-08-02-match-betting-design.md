# Design: Pari-mutuel match betting

**Date:** 2026-08-02
**Context:** Players want to stake real money on the outcome of tournament matches. Nothing like this exists in the codebase today — `lib/wallet` handles prizes/referrals/friendly-match stakes but has no concept of a bet, a pool, or odds.

**Legal note (recorded, not resolved by this spec):** Sentinel X's user base skews underage (see the KYC memory — most players are minors without a BVN). Real-money wagering is regulated gambling in Nigeria. This was flagged to the user during brainstorming; they chose to proceed with real money and no age gate as an explicit decision. This spec does not add an age gate — do not reintroduce one without the user re-opening that decision.

## Why pari-mutuel, not house-banked or peer-matched

Three structures were considered:
- **House-banked fixed odds** (Sentinel X sets odds and pays winners from its own balance) was the initial pick, but requires real capital in reserve to cover payouts — not affordable right now. Rejected.
- **Peer-to-peer 1:1 matching** (one bettor per side) doesn't scale — a popular match could have 20 people wanting to back the favorite and 3 backing the underdog, and 1:1 matching leaves 17 of them unable to bet. Rejected.
- **Pari-mutuel pooling** — any number of bettors on either side, stakes pool by side, winners split the losing side's pool proportional to their stake, platform takes a rake. The platform is never a counterparty and never carries payout risk beyond what's already in the pool. **Chosen.**

## Data model

### Migration `042_match_betting.sql`

```sql
ALTER TABLE public.matches
  ADD COLUMN betting_locked boolean NOT NULL DEFAULT false;

CREATE TABLE public.match_bets (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id      uuid        NOT NULL REFERENCES public.profiles(id),
  side           text        NOT NULL CHECK (side IN ('player_a', 'player_b')),
  stake_amount   integer     NOT NULL CHECK (stake_amount > 0),
  status         text        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'won', 'lost', 'refunded', 'voided')),
  payout_amount  integer,    -- null until settled; stake included for winners
  voided_reason  text,
  placed_at      timestamptz NOT NULL DEFAULT now(),
  settled_at     timestamptz
);

CREATE INDEX ON public.match_bets (match_id);
CREATE INDEX ON public.match_bets (player_id);

ALTER TABLE public.match_bets ENABLE ROW LEVEL SECURITY;

-- Players read their own bets. All writes go through server actions using
-- the admin client (same pattern as wallets/friendly_matches) — no insert
-- policy, so a client can't place a bet by writing the table directly.
CREATE POLICY "Players view own bets" ON public.match_bets
  FOR SELECT USING (auth.uid() = player_id);
```

`wallet_transactions.type` CHECK gains three values: `'bet_stake'`, `'bet_payout'`, `'bet_refund'` (extends the existing `WalletTxnType` union in `lib/wallet/service.ts` the same way `friendly_stake` was added).

No separate "market" table: a match *is* the market, 1:1. Market state is derived, never stored redundantly:

```ts
function bettingOpen(match: { status: string; scheduled_at: string | null; betting_locked: boolean }): boolean {
  if (match.betting_locked) return false
  if (match.status !== 'scheduled') return false
  if (!match.scheduled_at) return true // no time set yet — still open
  return new Date() < new Date(match.scheduled_at)
}
```

`betting_locked` is a one-way admin override (Admin Dashboard toggle, `requireAdmin()`-gated — betting is a financial action, matching the "moderator: no financial actions" rule in CLAUDE.md). It can only be set to lock early; there's no "reopen" path once the scheduled time has passed, since re-opening after players may already have seen a live result would recreate the exact insider-betting risk this design avoids.

## Placing a bet

`lib/betting/actions.ts`:

```ts
export async function placeBet(_prev: BetState, formData: FormData): Promise<BetState>
```

- Requires authentication (not staff — any logged-in player).
- Validates: `matchId` + `side` present; `stakeAmount` is an integer in `[100, 50_000]` (mirrors `walletWithdrawalSchema`'s pattern in `lib/wallet/schema.ts`); match exists and `bettingOpen(match)`; `player_id !== match.player_a_id && player_id !== match.player_b_id` (participants can't bet on their own match — the two players' identities come from the match row, not client input).
- Debits the wallet via the existing `debitWallet(admin, playerId, stakeAmount, 'bet_stake', matchId, ...)` — reuses the existing race-safe conditional-update debit, so insufficient balance is rejected the same way a withdrawal is.
- On successful debit, inserts the `match_bets` row.
- A player can place multiple bets on the same match (including both sides) — no uniqueness constraint. Simpler than trying to define "amend an existing bet" semantics, and consistent with real pari-mutuel pools where repeat bets are normal.

## Settlement

`lib/betting/settle.ts`:

```ts
export function computePariMutuelPayouts(
  bets: { id: string; side: 'player_a' | 'player_b'; stakeAmount: number }[],
  winningSide: 'player_a' | 'player_b',
  rakeRate = 0.10,
): Map<string, number> // bet id -> payout amount (0 = lost, no payout)
```

Pure function, unit-tested directly (mirrors `lib/friendly-matches/scoring.ts` + `scoring.test.ts`):
- `losingPool = sum(stake where side !== winningSide)`, `winningPool = sum(stake where side === winningSide)`.
- If `winningPool === 0`: nobody backed the actual winner — no payouts, `losingPool` is *not* redistributed (there's no one to redistribute it to). Every losing bet's payout is 0.
- If `losingPool === 0`: nobody backed the loser — winners just get their own stake back, no rake taken (nothing to rake), payout = stake.
- Otherwise: `distributable = losingPool * (1 - rakeRate)`; each winning bet's payout = `stake + distributable * (stake / winningPool)`.

`settleMatchBets(admin, matchId, winnerId)` in `lib/betting/settle.ts`:
1. Loads the match's `player_a_id`/`player_b_id` and all `active` `match_bets` for it.
2. Maps `winnerId` to `'player_a' | 'player_b'`, calls `computePariMutuelPayouts`.
3. For each bet: if payout > 0, `creditWallet(admin, bet.player_id, payout, 'bet_payout', bet.id)` and mark `status: 'won', payout_amount: payout`; else mark `status: 'lost', payout_amount: 0`. Both branches set `settled_at`.

`refundMatchBets(admin, matchId)` — used for no-show/forfeit resolutions where there was no real contest: refunds every `active` bet's stake via `creditWallet(admin, ..., 'bet_refund', ...)`, marks `status: 'refunded'`.

### Call sites (existing admin actions, minimally touched)

- `confirmResult` in `lib/matches/verify-actions.ts` — after the match is updated to `status: 'completed'`, compute `matchWinnerId({ status: 'completed', score_a: scoreA, score_b: scoreB, player_a_id: m.player_a_id, player_b_id: m.player_b_id })` (the same helper the knockout-final prize branch already calls, but needed here for *every* completed match, not just finals). Knockout matches can't draw (`confirmResult` already rejects `scoreA === scoreB` for knockout rounds earlier in the function), so `winnerId` is only ever `null` for a group-stage draw. If `winnerId` is non-null, call `settleMatchBets(admin, id, winnerId)`; if `null` (group draw), call `refundMatchBets(admin, id)` — a draw has no side to redistribute the pool to, so it's a push, not a settlement.
- `declareNoShowWinner` in `lib/matches/admin-actions.ts` (resolution: `'walkover'`) — call `refundMatchBets(admin, id)` instead of settling. A walkover isn't a real contest; settling it as a normal result would let someone bet on the no-show winner with insider knowledge the moment the walkover is declared.
- `markBothNoShow` in `lib/matches/admin-actions.ts` (resolution: `'no_show_draw'` or `'forfeited'`) — same, call `refundMatchBets(admin, id)`.

None of these call sites need to change their own control flow beyond one added call — settlement/refund failure doesn't roll back the match result (consistent with how prize crediting already isn't transactional with the result update).

## Admin: void a bet

`voidBet(betId, reason)` in `lib/betting/admin-actions.ts`, `requireAdmin()`-gated:
- Only valid while the bet is still `status: 'active'` (i.e., before the match settles).
- Refunds the stake (`creditWallet(..., 'bet_refund', ...)`), sets `status: 'voided'`, `voided_reason: reason`.
- Surfaced on the admin match-review page (`app/admin/matches/[id]`) as a list of active bets on that match with a void action per row — this is the tool for unwinding a bet placed with insider knowledge before the admin confirms.

## UI

- `/betting` — public hub page listing every match with `bettingOpen(match) === true`, across all tournaments: tournament name, players, scheduled time, current pool split (`player_a` pool vs `player_b` pool), computed live from `match_bets`.
- Betting panel on `app/(public)/matches/[id]/page.tsx`: two side buttons (Player A / Player B) each showing the current implied payout multiplier — `(totalPool - rake-adjusted-losingPool-share) / sidePool`, essentially "what a ₦1 stake on this side would return right now if the pool closed this instant" — plus each player's Sentinel Score shown next to their name as an informational favorite/underdog signal (not used in any payout math). Stake input + "Place Bet" button call `placeBet`. If the logged-in player already has bets on this match, they're listed above the form. If the logged-in player is one of the two match participants, the panel renders a disabled state explaining why.

## Testing

- `lib/betting/settle.test.ts`: `computePariMutuelPayouts` — even split, uneven split, one-sided winning pool (no payouts), one-sided losing pool (stake-back, no rake), multiple bets from the same player on the same side.
- `lib/betting/actions.test.ts` (if the codebase's existing action tests follow this pattern — confirm against `lib/matches/*.test.ts` conventions): rejects participant self-bets, rejects out-of-range stakes, rejects bets when `bettingOpen` is false.
