# Mobile Phase 6a Wallet — Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wallet balance changes atomic in Postgres, extract the web wallet/KYC logic into shared services, and expose ten owner-scoped `/api/mobile/v1/wallet/**` operations for the mobile wallet.

**Architecture:** Two SQL functions (`wallet_apply`, `wallet_request_withdrawal`) own every balance mutation; `creditWallet`/`debitWallet` become thin callers so web, prizes, referrals and deposits all gain the fix. Web server actions and the new endpoints call the same TypeScript services. Endpoints use `defineEndpoint` (`auth: 'user'`, `idempotent: true` for money creation) and `hitLimit` for the approved limits.

**Tech Stack:** Next.js 14, TypeScript, Supabase (service-role `ctx.admin`), Zod, Vitest, Paystack REST.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-phase6a-wallet-design.md` (D1 and D2 approved 2026-10-11; D3 open).

## Global Constraints

- Every money query is scoped by `ctx.userId`; no player id from body, path or query.
- Reads return only `maskAccountNumber()` output (`•••1234`); no operation returns, logs, or accepts a BVN, a full saved account number, or a Paystack key. `admin_note` is never returned.
- Amounts are integer naira, 100 to 100,000,000 (the web `walletDepositSchema` / `walletWithdrawalSchema` bounds, reused, not copied).
- `Idempotency-Key` required on `POST /wallet/deposits` and `POST /wallet/withdrawals`.
- Limits (D2): `startWalletDeposit` 10 per hour per user; `resolvePayoutAccount` 10 per 15 minutes per user; `hitLimit` fails open if its ledger is unreachable.
- `assertNotPendingDeletion` guards deposit start, withdrawal request and payout-account set.
- Web behavior must not change: each extraction is preceded by a characterization test of the current result.
- No production data writes during development or tests. DB tests run only against staging `ofxmoxpvwbemfouaowoa`, guarded by a URL check.
- Run tests with `node node_modules/vitest/vitest.mjs run <file>`; typecheck with `node node_modules/typescript/bin/tsc --noEmit`.

## Review Focus

- Two concurrent `wallet_apply` calls (credit during debit, callback + webhook) never lose an update: final balance equals start + sum of deltas. Pinned in Task 2.
- A withdrawal that fails the debit leaves no `withdrawal_requests` row and no ledger row; a second pending request is refused with no debit. Pinned in Task 2.
- A deposit whose credit fails is not left `paid` with no credit. Pinned in Task 4.
- Polling another player's deposit reference returns the same `not_found` as an unknown one and never calls Paystack. Pinned in Task 8.
- Replaying the same `Idempotency-Key` creates one deposit row / one debit. Pinned in Tasks 7 and 8.
- No response contains an unmasked account number or `admin_note`. Pinned in Tasks 6 and 9.

---

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/20261011120000_wallet_atomic_functions.sql` | `wallet_apply`, `wallet_request_withdrawal`; execute rights for `service_role` only |
| `lib/wallet/service.ts` (modify) | `creditWallet`/`debitWallet` call `wallet_apply` |
| `lib/wallet/service.test.ts` (create) | Unit tests with a fake `admin.rpc` |
| `lib/wallet/atomic.staging.test.ts` (create) | Concurrency proof against staging only |
| `lib/wallet/confirm.ts` (modify) | Revert the `paid` claim if the credit fails |
| `lib/wallet/overview.ts`, `transactions-page.ts` (create) | Shared reads for web pages and endpoints |
| `lib/wallet/deposit-service.ts`, `withdrawal-service.ts` (create) | Typed money services; actions keep their shells |
| `lib/kyc/payout-service.ts` (create) | resolve / save / clear payout account |
| `lib/rate-limit/account-limiter.ts` (modify) | New keys and limits |
| `lib/mobile-api/errors.ts` (modify) | `Errors.rateLimited(retryAfterSeconds)` |
| `lib/mobile-api/endpoints/wallet.ts` (create) | The ten operations |
| `app/api/mobile/v1/wallet/**/route.ts` (create) | One route file per path |
| `openapi/mobile-v1.json` (regenerate) | Contract copied by mobile |

---

### Task 1: Land the spec and branch

**Files:** none new.

- [ ] **Step 1:** Review the spec branch `docs/phase6a-wallet-spec`; once the owner approves the plan, merge it `--no-ff` into `main` and push.
- [ ] **Step 2:** Create `phase6a/wallet-web` from the new `main` (worktree preferred). Confirm `git status` is clean apart from the existing untracked `.superpowers/` and docs folders.

---

### Task 2: Atomic wallet SQL functions (D1)

**Files:**
- Create: `supabase/migrations/20261011120000_wallet_atomic_functions.sql`
- Create: `lib/wallet/atomic.staging.test.ts`

**Interfaces:**
- Produces: `public.wallet_apply(p_player uuid, p_delta integer, p_type text, p_reference uuid, p_note text, p_category text) RETURNS integer` — new balance, or `NULL` when a debit would take the balance below zero (nothing written).
- Produces: `public.wallet_request_withdrawal(p_player uuid, p_amount integer, p_bank_name text, p_account_number text, p_account_name text, p_category text) RETURNS jsonb` — `{"status":"ok","id":"<uuid>","balance":<int>}`, `{"status":"pending_exists"}` or `{"status":"insufficient"}`.

- [ ] **Step 1: Write the migration**

```sql
-- Atomic wallet mutations. Replaces the read-modify-write in lib/wallet/service.ts, which could
-- lose an update when two writers read the same balance. Service-role only.
CREATE OR REPLACE FUNCTION public.wallet_apply(
  p_player    uuid,
  p_delta     integer,
  p_type      text,
  p_reference uuid,
  p_note      text,
  p_category  text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'wallet_apply: delta must not be zero';
  END IF;

  IF p_delta > 0 THEN
    INSERT INTO wallets (player_id, balance) VALUES (p_player, 0)
    ON CONFLICT (player_id) DO NOTHING;
  END IF;

  UPDATE wallets
     SET balance = balance + p_delta, updated_at = now()
   WHERE player_id = p_player AND balance + p_delta >= 0
  RETURNING balance INTO v_balance;

  IF NOT FOUND THEN
    RETURN NULL; -- insufficient balance (or no wallet on a debit); nothing was written
  END IF;

  INSERT INTO wallet_transactions (player_id, amount, type, reference_id, note, category)
  VALUES (p_player, p_delta, p_type, p_reference, p_note, p_category);

  RETURN v_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.wallet_request_withdrawal(
  p_player         uuid,
  p_amount         integer,
  p_bank_name      text,
  p_account_number text,
  p_account_name   text,
  p_category       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_balance integer;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'wallet_request_withdrawal: amount must be positive';
  END IF;

  BEGIN
    INSERT INTO withdrawal_requests (player_id, amount, bank_name, account_number, account_name, status)
    VALUES (p_player, p_amount, p_bank_name, p_account_number, p_account_name, 'pending')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'pending_exists');
  END;

  v_balance := wallet_apply(p_player, -p_amount, 'withdrawal_request', v_id, NULL, p_category);
  IF v_balance IS NULL THEN
    DELETE FROM withdrawal_requests WHERE id = v_id; -- same transaction: never visible to anyone
    RETURN jsonb_build_object('status', 'insufficient');
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'id', v_id, 'balance', v_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_apply(uuid, integer, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_request_withdrawal(uuid, integer, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_apply(uuid, integer, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_request_withdrawal(uuid, integer, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write the staging-only concurrency test.** It must refuse to run unless `process.env.NEXT_PUBLIC_SUPABASE_URL` contains `ofxmoxpvwbemfouaowoa` (use `describe.skipIf`). It creates one throwaway `zzqa_wallet_<rand>` auth user + profile through the admin API, then asserts:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

const onStaging = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ofxmoxpvwbemfouaowoa')

describe.skipIf(!onStaging)('wallet_apply atomicity (staging only)', () => {
  const admin = createAdminClient()
  let playerId = ''

  beforeAll(async () => {
    const email = `zzqa+wallet${Date.now()}@example.com`
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { username: `zzqa_w${Date.now() % 1e6}` } })
    if (error || !data.user) throw error ?? new Error('no user')
    playerId = data.user.id
    await admin.rpc('wallet_apply', { p_player: playerId, p_delta: 1000, p_type: 'admin_credit', p_reference: null, p_note: 'seed', p_category: 'bonus' })
  })

  afterAll(async () => { if (playerId) await admin.auth.admin.deleteUser(playerId) })

  it('20 parallel credits and debits never lose an update', async () => {
    const calls = Array.from({ length: 20 }, (_, i) =>
      admin.rpc('wallet_apply', { p_player: playerId, p_delta: i % 2 === 0 ? 50 : -30, p_type: i % 2 === 0 ? 'admin_credit' : 'withdrawal_request', p_reference: null, p_note: null, p_category: i % 2 === 0 ? 'bonus' : 'withdrawal' }))
    const results = await Promise.all(calls)
    expect(results.every((r) => !r.error)).toBe(true)
    const { data } = await admin.from('wallets').select('balance').eq('player_id', playerId).single()
    expect(data!.balance).toBe(1000 + 10 * 50 - 10 * 30)
    const { count } = await admin.from('wallet_transactions').select('id', { count: 'exact', head: true }).eq('player_id', playerId)
    expect(count).toBe(21)
  })

  it('a debit above the balance returns null and writes nothing', async () => {
    const before = (await admin.from('wallets').select('balance').eq('player_id', playerId).single()).data!.balance
    const { data, error } = await admin.rpc('wallet_apply', { p_player: playerId, p_delta: -(before + 1), p_type: 'withdrawal_request', p_reference: null, p_note: null, p_category: 'withdrawal' })
    expect(error).toBeNull()
    expect(data).toBeNull()
    expect((await admin.from('wallets').select('balance').eq('player_id', playerId).single()).data!.balance).toBe(before)
  })

  it('withdrawal: second pending is refused, insufficient leaves no row', async () => {
    const first = await admin.rpc('wallet_request_withdrawal', { p_player: playerId, p_amount: 100, p_bank_name: 'Test Bank', p_account_number: '0000000000', p_account_name: 'ZZQA', p_category: 'withdrawal' })
    expect(first.data).toMatchObject({ status: 'ok' })
    const second = await admin.rpc('wallet_request_withdrawal', { p_player: playerId, p_amount: 100, p_bank_name: 'Test Bank', p_account_number: '0000000000', p_account_name: 'ZZQA', p_category: 'withdrawal' })
    expect(second.data).toEqual({ status: 'pending_exists' })
    await admin.from('withdrawal_requests').update({ status: 'rejected' }).eq('player_id', playerId)
    const big = await admin.rpc('wallet_request_withdrawal', { p_player: playerId, p_amount: 99_999_999, p_bank_name: 'Test Bank', p_account_number: '0000000000', p_account_name: 'ZZQA', p_category: 'withdrawal' })
    expect(big.data).toEqual({ status: 'insufficient' })
    const { count } = await admin.from('withdrawal_requests').select('id', { count: 'exact', head: true }).eq('player_id', playerId).eq('status', 'pending')
    expect(count).toBe(0)
  })
})
```

- [ ] **Step 3:** Ask the owner to approve running the migration on **staging** (`mcp__claude_ai_Supabase__apply_migration`, project `ofxmoxpvwbemfouaowoa`, name `wallet_atomic_functions`). Apply it, then run `NEXT_PUBLIC_SUPABASE_URL=<staging url> SUPABASE_SERVICE_ROLE_KEY=<staging key> node node_modules/vitest/vitest.mjs run lib/wallet/atomic.staging.test.ts`. Expected: 3 passed. Before the migration the same test must fail with "function ... does not exist" (run it first to see red).
- [ ] **Step 4:** Regenerate `lib/supabase/types.ts` `Functions` entries for both functions (`mcp__claude_ai_Supabase__generate_typescript_types` on staging, then keep only the added `wallet_apply` / `wallet_request_withdrawal` blocks if the rest of the diff is noise). Run `tsc --noEmit`.
- [ ] **Step 5: Commit** `git add supabase/migrations lib/wallet/atomic.staging.test.ts lib/supabase/types.ts && git commit -m "feat(wallet): atomic wallet_apply and wallet_request_withdrawal"`.

---

### Task 3: Route `creditWallet` / `debitWallet` through `wallet_apply`

**Files:**
- Modify: `lib/wallet/service.ts`
- Create: `lib/wallet/service.test.ts`

**Interfaces:**
- Consumes: `wallet_apply` (Task 2).
- Produces: `creditWallet(admin, playerId, amount, type, referenceId, note?) => Promise<{ ok: true; balance: number } | { ok: false }>` (was `void`; existing callers ignore the result, so they compile unchanged; it **never throws**, so a failing credit cannot abort a prize loop). `debitWallet` keeps `Promise<{ ok: true } | { ok: false; error: string }>`.
- Produces: `categoryFor(type: WalletTxnType): string` (exported, wraps the existing `DEFAULT_CATEGORY_BY_TYPE`).

- [ ] **Step 1: Write the failing test** (`lib/wallet/service.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest'
import { creditWallet, debitWallet } from './service'

const fakeAdmin = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as never

describe('creditWallet', () => {
  it('calls wallet_apply with a positive delta and the default category', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1500, error: null })
    const res = await creditWallet(fakeAdmin(rpc), 'p1', 500, 'prize', 'ref1', 'note')
    expect(rpc).toHaveBeenCalledWith('wallet_apply', { p_player: 'p1', p_delta: 500, p_type: 'prize', p_reference: 'ref1', p_note: 'note', p_category: 'tournament_prize' })
    expect(res).toEqual({ ok: true, balance: 1500 })
  })
  it('returns ok:false and logs, never throws, when the rpc errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(creditWallet(fakeAdmin(rpc), 'p1', 500, 'prize', null)).resolves.toEqual({ ok: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('debitWallet', () => {
  it('uses a negative delta', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 400, error: null })
    expect(await debitWallet(fakeAdmin(rpc), 'p1', 100, 'withdrawal_request', 'wr1')).toEqual({ ok: true })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_delta: -100, p_category: 'withdrawal' })
  })
  it('maps a null balance to insufficient', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    expect(await debitWallet(fakeAdmin(rpc), 'p1', 100, 'withdrawal_request', null)).toEqual({ ok: false, error: 'Insufficient wallet balance.' })
  })
  it('maps an rpc error to a failure, not an insufficient-balance claim', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await debitWallet(fakeAdmin(rpc), 'p1', 100, 'withdrawal_request', null)).toEqual({ ok: false, error: 'Wallet is unavailable right now.' })
  })
})
```

- [ ] **Step 2:** Run `node node_modules/vitest/vitest.mjs run lib/wallet/service.test.ts`. Expected: FAIL (`rpc` not called; old code uses `.from`).
- [ ] **Step 3: Implement.** Replace the bodies in `lib/wallet/service.ts`; keep `getWalletBalance`, `WalletTxnType` and `DEFAULT_CATEGORY_BY_TYPE` as they are, delete the old read-modify-write comments:

```ts
export const categoryFor = (type: WalletTxnType): string => DEFAULT_CATEGORY_BY_TYPE[type]

export async function creditWallet(
  admin: SupabaseClient<Database>,
  playerId: string,
  amount: number,
  type: WalletTxnType,
  referenceId: string | null,
  note?: string,
): Promise<{ ok: true; balance: number } | { ok: false }> {
  const { data, error } = await admin.rpc('wallet_apply', {
    p_player: playerId, p_delta: amount, p_type: type, p_reference: referenceId, p_note: note ?? null, p_category: categoryFor(type),
  })
  if (error || data == null) {
    console.error('[wallet] credit failed', { type, referenceId, message: error?.message })
    return { ok: false }
  }
  return { ok: true, balance: data }
}

export async function debitWallet(
  admin: SupabaseClient<Database>,
  playerId: string,
  amount: number,
  type: WalletTxnType,
  referenceId: string | null,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc('wallet_apply', {
    p_player: playerId, p_delta: -amount, p_type: type, p_reference: referenceId, p_note: note ?? null, p_category: categoryFor(type),
  })
  if (error) {
    console.error('[wallet] debit failed', { type, referenceId, message: error.message })
    return { ok: false, error: 'Wallet is unavailable right now.' }
  }
  if (data == null) return { ok: false, error: 'Insufficient wallet balance.' }
  return { ok: true }
}
```

- [ ] **Step 4:** Run the focused test (green), then `node node_modules/vitest/vitest.mjs run lib/wallet lib/admin lib/matches lib/tournaments lib/friendly-matches` and `tsc --noEmit`. Fix any existing test that mocked the old `.from('wallets')` chain by mocking `rpc` instead; do not loosen assertions.
- [ ] **Step 5: Commit** `feat(wallet): credit/debit through wallet_apply`.

---

### Task 4: Deposit confirm must not strand a paid, uncredited deposit

**Files:**
- Modify: `lib/wallet/confirm.ts:63-80`
- Modify: `lib/wallet/confirm.test.ts`

**Interfaces:** `confirmWalletDeposit(reference)` unchanged; returns `'not_successful'` when the credit fails after the claim.

- [ ] **Step 1: Add the failing test** to `confirm.test.ts` (mock `./service` `creditWallet` to `{ ok: false }`, the admin client's `wallet_deposits` update chain to claim one row, and assert a second update sets `status: 'pending'` for that id and the function returns `'not_successful'`). Run red.
- [ ] **Step 2: Implement.** After the claim:

```ts
if (claimed && claimed.length > 0) {
  const credit = await creditWallet(db, existing.player_id, existing.amount, 'deposit', existing.id, 'Wallet top-up via Paystack')
  if (!credit.ok) {
    // Put it back so the webhook retry / the next poll can credit it; never leave paid-without-credit.
    await db.from('wallet_deposits').update({ status: 'pending' }).eq('id', existing.id).eq('status', 'paid')
    console.error('[confirmWalletDeposit] credit failed, claim released', { reference })
    return 'not_successful'
  }
  await notifyInApp({ /* unchanged */ })
}
```

- [ ] **Step 3:** Run `confirm.test.ts` green; commit `fix(wallet): release deposit claim when credit fails`.

---

### Task 5: Shared reads — overview and transactions page

**Files:**
- Create: `lib/wallet/overview.ts`, `lib/wallet/overview.test.ts`, `lib/wallet/transactions-page.ts`, `lib/wallet/transactions-page.test.ts`
- Modify: `app/[locale]/dashboard/wallet/page.tsx`, `app/[locale]/dashboard/wallet/transactions/page.tsx`

**Interfaces:**
- Produces:

```ts
export type WalletFilter = 'all' | 'winnings' | 'withdrawals' | 'deposits'
export interface WalletOverview {
  balance: number
  pendingWithdrawal: number
  earnings: { tournamentPrize: number; referral: number; bonus: number; tournamentPrizeTrendPct: number | null }
  recentTransactions: WalletTxnRow[]
  payoutAccount: { bankName: string; accountName: string; accountNumberMasked: string } | null
  kycVerified: boolean
  activeWithdrawal: { id: string; amount: number; requestedAt: string } | null
}
export function loadWalletOverview(admin: Admin, playerId: string, now?: Date): Promise<{ ok: true; value: WalletOverview } | { ok: false; reason: 'load_failed' }>
export function applyFilter<Q extends { eq: (c: string, v: string) => Q }>(query: Q, filter: WalletFilter): Q
export function parseFilter(raw: string | null | undefined): WalletFilter // unknown -> 'all'
export function loadTransactionsPage(admin: Admin, playerId: string, args: { filter: WalletFilter; cursor: { t: string; id: string } | null }): Promise<{ ok: true; items: WalletTxnRow[]; nextCursor: string | null } | { ok: false }>
```

- [ ] **Step 1: Characterize.** Write `overview.test.ts` with a fake admin that returns: balance 5000; ledger rows spanning this and last month (`tournament_prize`, `referral`, `bonus`, a `withdrawal_request` row tied to a pending request, a `deposit`); a pending withdrawal of 1000; a verified payout account `0123456789`. Assert exactly the values the current web page computes (`summarizeEarningsByCategory`, `monthOverMonthChange`, `mapTransactionRows`) plus `accountNumberMasked === '•••6789'`, and that **every** query carries `player_id = playerId` (include a stranger's rows in the fake and assert they never appear). Also assert a read error yields `{ ok: false, reason: 'load_failed' }`, not zeros. Run red (module missing).
- [ ] **Step 2: Implement** `overview.ts` moving the queries out of the wallet page (balance, ledger, pending withdrawals, payout account, KYC flag) and reusing `summarizeEarningsByCategory`, `monthOverMonthChange`, `mapTransactionRows`, `maskAccountNumber`. Run green.
- [ ] **Step 3: transactions-page.** Test: filters map to `category='tournament_prize'` / `category='withdrawal'` / `type='deposit'`; unknown filter -> `'all'`; keyset ordering via `keysetFilter` from `lib/mobile-api/history-cursor.ts` with `HISTORY_PAGE_SIZE + 1` fetch and `pageOf`; withdrawal-request rows take their display status from `withdrawal_requests`. Implement, run green.
- [ ] **Step 4:** Refactor the two web pages to call these (the transactions web page keeps its offset paging by using `applyFilter` + `parseFilter` only). Add or keep a page-level render test so the web UI props are unchanged; run `tsc --noEmit`.
- [ ] **Step 5: Commit** `refactor(wallet): shared overview and transactions reads`.

---

### Task 6: Shared money services — deposit, withdrawal, payout account

**Files:**
- Create: `lib/wallet/deposit-service.ts`, `lib/wallet/withdrawal-service.ts`, `lib/kyc/payout-service.ts` (+ a `.test.ts` for each)
- Modify: `lib/wallet/deposit.ts`, `lib/wallet/actions.ts`, `lib/kyc/actions.ts`

**Interfaces:**

```ts
// deposit-service.ts
export type StartDepositResult =
  | { ok: true; reference: string; authorizationUrl: string; amount: number; fee: number; total: number }
  | { ok: false; reason: 'email_required' | 'pending_deletion' | 'insert_failed' | 'paystack_failed' }
export function startDeposit(admin: Admin, args: { playerId: string; email: string | null; amount: number }): Promise<StartDepositResult>

// withdrawal-service.ts
export type SubmitWithdrawalResult =
  | { ok: true; id: string; amount: number; requestedAt: string; payoutAccount: PayoutAccountMasked }
  | { ok: false; reason: 'pending_deletion' | 'kyc_required' | 'insufficient_balance' | 'withdrawal_pending' | 'failed' }
export function submitWithdrawal(admin: Admin, args: { playerId: string; amount: number }): Promise<SubmitWithdrawalResult>

// payout-service.ts
export interface PayoutAccountMasked { bankName: string; accountName: string; accountNumberMasked: string }
export function resolvePayout(args: { bankCode: string; accountNumber: string }): Promise<{ ok: true; accountName: string } | { ok: false; reason: 'validation' | 'account_unresolvable' }>
export function savePayoutAccount(admin: Admin, args: { playerId: string; bankCode: string; accountNumber: string }): Promise<{ ok: true; payoutAccount: PayoutAccountMasked } | { ok: false; reason: 'pending_deletion' | 'already_verified' | 'account_unresolvable' | 'unknown_bank' | 'payout_unavailable' | 'validation' }>
export function clearPayoutAccount(admin: Admin, playerId: string): Promise<{ ok: true } | { ok: false }>
```

- [ ] **Step 1: Characterize first.** For each service, write the test against the current server-action behavior using fakes (Paystack functions mocked: `initializeTransaction`, `resolveAccount`, `listBanks`): deposit inserts a `pending` row with `fee = computePaystackFee(amount)` and charges `(amount + fee) * 100` kobo with the existing callback URL; withdrawal reads the stored payout account (never an argument), calls `admin.rpc('wallet_request_withdrawal', {...})`, maps `pending_exists`->`withdrawal_pending`, `insufficient`->`insufficient_balance`, then fires `notifyStaff` on `ok`; payout save refuses a verified account (`already_verified`), resolves the name and bank name server-side, upserts `player_kyc` as `verified` and sets `profiles.kyc_verified`. Include: pending-deletion refusal for all three, an unknown bank code (`unknown_bank`), and that no returned object contains the raw account number. Run red.
- [ ] **Step 2: Implement** the three services by moving the logic out of the actions. `submitWithdrawal` replaces the insert + `debitWallet` + compensating delete with the single `wallet_request_withdrawal` RPC (pass `categoryFor('withdrawal_request')`). Mask with `maskAccountNumber`. Run green.
- [ ] **Step 3: Rewire the actions** to thin shells: `initiateWalletDeposit` calls `startDeposit` then `redirect(authorizationUrl)`; `requestWalletWithdrawal` calls `submitWithdrawal` and maps reasons back to the exact existing error strings; `submitKyc`/`removePayoutAccount` call the payout service. Existing action tests (if any) stay green unmodified; `revalidatePath` calls stay in the actions.
- [ ] **Step 4:** `tsc --noEmit`, `next lint`, and the whole `lib/wallet lib/kyc` test folders green. Commit `refactor(wallet): shared deposit, withdrawal and payout services`.

---

### Task 7: Limits and the ten endpoints

**Files:**
- Modify: `lib/rate-limit/account-limiter.ts`, `lib/mobile-api/errors.ts`
- Create: `lib/mobile-api/endpoints/wallet.ts`, `lib/mobile-api/endpoints/wallet.test.ts`
- Create: `app/api/mobile/v1/wallet/route.ts` (`GET`), `wallet/transactions/route.ts`, `wallet/banks/route.ts`, `wallet/payout-account/route.ts` (`PUT`, `DELETE`), `wallet/payout-account/resolve/route.ts`, `wallet/deposits/route.ts` (`POST`), `wallet/deposits/[reference]/route.ts`, `wallet/withdrawals/route.ts` (`GET`, `POST`)
- Modify: `lib/mobile-api/endpoints/index.ts` (add to `ALL_ENDPOINTS`)

**Interfaces:**
- Produces in `account-limiter.ts`:

```ts
export const DEPOSIT_START_LIMIT = { limit: 10, windowMs: 3_600_000 } as const
export const RESOLVE_LIMIT = { limit: 10, windowMs: 900_000 } as const
export const depositKey = (userId: string) => `deposit:${userId}`
export const resolveKey = (userId: string) => `resolve:${userId}`
```

- Produces in `errors.ts` (add): `Errors.rateLimited(retryAfterSeconds)` -> `new ApiError(429, 'rate_limited', 'Too many attempts. Try again shortly.', { retryAfterSeconds: String(n) })`.
- Operation ids, methods and paths exactly as the spec table: `getMyWallet`, `listMyWalletTransactions`, `listWalletBanks`, `resolvePayoutAccount`, `setPayoutAccount`, `removePayoutAccount`, `startWalletDeposit`, `getWalletDeposit`, `requestWithdrawal`, `listMyWithdrawals`.

- [ ] **Step 1: Write the failing endpoint tests** in `wallet.test.ts`, following `referrals.test.ts` (hoisted `authenticate` mock returning `{ userId: 'owner-1', email: 'o@x.test', admin: 'admin' }`, services mocked). One `describe` per operation. Required cases:
  - `getMyWallet`: returns the overview; `load_failed` -> 500 `wallet_load_failed`; service called with `('admin', 'owner-1')`.
  - `listMyWalletTransactions`: `?filter=bogus` -> treated as `all`; a malformed `cursor` -> 400 `invalid_cursor`; `nextCursor` passes through.
  - `resolvePayoutAccount`: 10th call allowed, 11th -> 429 `rate_limited` with `retryAfterSeconds` and **no Paystack call**; invalid body (9-digit number) -> 400 `validation`; limiter outage (`hitLimit` returns allowed) still resolves.
  - `setPayoutAccount`: maps `already_verified` -> 409, `account_unresolvable` -> 422, `unknown_bank` -> 422, `payout_unavailable` -> 503, `pending_deletion` -> 403 `account_pending_deletion`; body schema rejects extra `firstName` silently (strip) and never needs names.
  - `startWalletDeposit`: `idempotent: true` (missing `Idempotency-Key` -> 400 via framework); amount 99 -> 400, 100_000_001 -> 400, 150.5 -> 400; 11th start within the hour -> 429; `email_required` -> 422; the Paystack failure -> 502 `payment_unavailable`; success returns `{ reference, authorizationUrl, amount, fee, total }`.
  - `requestWithdrawal`: idempotent; each reason -> its status (`kyc_required` 422, `insufficient_balance` 422, `withdrawal_pending` 409, `account_pending_deletion` 403); success body contains `payoutAccount.accountNumberMasked` and **no** key named `accountNumber`.
  - `listMyWithdrawals`: asserts the select column list excludes `admin_note` (inspect the fake's `select` argument) and rows are filtered by `player_id = 'owner-1'`.
  - Every operation: unauthenticated -> 401 (authenticate throws `Errors.unauthorized()`).
- [ ] **Step 2:** Run `node node_modules/vitest/vitest.mjs run lib/mobile-api/endpoints/wallet.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `wallet.ts`.** Skeleton for the two highest-risk operations (the other eight follow the same `defineEndpoint` shape and the `referrals.ts` error-mapping style):

```ts
const money = z.coerce.number().int().min(100).max(100_000_000) // same bounds as walletDepositSchema / walletWithdrawalSchema

export const startWalletDepositEndpoint = defineEndpoint({
  operationId: 'startWalletDeposit',
  method: 'POST',
  path: '/wallet/deposits',
  summary: 'Start a Paystack wallet top-up. Returns the checkout URL; credit happens only after Paystack confirms.',
  auth: 'user',
  idempotent: true,
  body: z.object({ amount: money }),
  response: z.object({ reference: z.string(), authorizationUrl: z.string(), amount: z.number().int(), fee: z.number().int(), total: z.number().int() }),
  handler: async ({ ctx, body }) => {
    const gate = await hitLimit(ctx.admin, { key: depositKey(ctx.userId), ...DEPOSIT_START_LIMIT })
    if (!gate.allowed) throw Errors.rateLimited(gate.retryAfterSeconds)
    const r = await startDeposit(ctx.admin, { playerId: ctx.userId, email: ctx.email, amount: body.amount })
    if (r.ok) return { reference: r.reference, authorizationUrl: r.authorizationUrl, amount: r.amount, fee: r.fee, total: r.total }
    if (r.reason === 'pending_deletion') throw new ApiError(403, 'account_pending_deletion', 'Cancel your account deletion to add money.')
    if (r.reason === 'email_required') throw new ApiError(422, 'email_required', 'Add an email to your account to pay.')
    throw new ApiError(502, 'payment_unavailable', 'Payment could not be started. Please try again.')
  },
})

export const getWalletDepositEndpoint = defineEndpoint({
  operationId: 'getWalletDeposit',
  method: 'GET',
  path: '/wallet/deposits/{reference}',
  summary: "Poll one of the signed-in player's wallet deposits. The webhook stays the source of truth.",
  auth: 'user',
  response: z.object({ status: z.enum(['confirmed', 'already_paid', 'not_successful', 'not_found']), balance: z.number().int().nullable() }),
  handler: async ({ ctx, params }) => {
    const { data } = await ctx.admin.from('wallet_deposits').select('id').eq('paystack_reference', params.reference).eq('player_id', ctx.userId).maybeSingle()
    if (!data) return { status: 'not_found' as const, balance: null } // identical for unknown and foreign references; no Paystack call
    const status = await confirmWalletDeposit(params.reference)
    const balance = status === 'confirmed' || status === 'already_paid' ? await getWalletBalance(ctx.admin, ctx.userId) : null
    return { status, balance }
  },
})
```

  Parameters for `{reference}` and the `cursor`/`filter` queries are declared with `parameters:` like the existing path-param endpoints.
- [ ] **Step 4:** Add each endpoint to `ALL_ENDPOINTS` and create the route files (`export const GET = xEndpoint.handler`, etc.). Run the focused test green plus the route-file contract test (`lib/mobile-api/route-files.test.ts`).
- [ ] **Step 5: Commit** `feat(mobile-api): wallet, deposit, withdrawal and payout-account endpoints`.

---

### Task 8: Contract, review gate and rollout order

**Files:** `openapi/mobile-v1.json`

- [ ] **Step 1:** `node node_modules/vitest/vitest.mjs run lib/mobile-api/openapi.test.ts -u`; inspect the diff: it must only add the ten operations, nothing else. Commit `chore(openapi): wallet operations`.
- [ ] **Step 2: Cold read of the whole diff** against the spec "Review focus": every query scoped by `ctx.userId`; no raw account number or `admin_note` in any response or log; `creditWallet` still never throws; web action error strings unchanged; no `.from('wallets').update(` left in `lib/` (`grep -rn "from('wallets')" lib | grep -v select`).
- [ ] **Step 3:** `git fetch origin main`, rebase. Run the full `node node_modules/vitest/vitest.mjs run --maxWorkers=2`, `tsc --noEmit`, `next lint`, and a staging-configured `next build`. Expected: all green, build exits 0.
- [ ] **Step 4: Rollout order (do not reorder).** (a) Migration already on staging (Task 2). (b) With explicit owner approval, apply the same migration to **production** *before* deploying — it only adds two unused functions, so old code is unaffected. (c) Verify with `select proname from pg_proc where proname like 'wallet_%'` on production. (d) Merge `phase6a/wallet-web` `--no-ff` into `main`, confirm the merged tree equals the tested tree, push. (e) Smoke `GET /api/mobile/v1/wallet` on the deployed web with a staging/test bearer only.
- [ ] **Step 5:** Record the slice in the web progress log and note D3 status. Tell mobile the contract is ready.
