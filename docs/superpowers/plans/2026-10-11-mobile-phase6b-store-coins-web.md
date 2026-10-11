# Mobile Phase 6b Store and Atomic Coins — Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every SX Coin balance change atomic in Postgres, move the four existing coin spenders onto a strict spend, share the store purchase/equip logic between web and mobile, and expose `GET /store`, `purchase`, `equip` and `unequip` plus additive wallet/`me` fields.

**Architecture:** One migration adds `coin_apply`, `store_purchase` and `store_equip` (service-role only). `recordCoinTransaction` keeps its signature and calls `coin_apply` in clamp mode; new `spendCoins` calls it strict. Web server actions become thin shells over `lib/store/*-service.ts`; the mobile endpoints call the same services.

**Tech Stack:** Next.js 14, TypeScript, Supabase service-role client, Zod, Vitest, Postgres/plpgsql.

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-phase6b-store-coins-design.md` (D1 atomic coins and D2 bundled art approved 2026-10-11).

## Global Constraints

- Every coin and store query is scoped by `ctx.userId`; no player id from a body, path or query. Only `GET /store`'s catalogue is public.
- `coin_apply`, `store_purchase`, `store_equip`: `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`. Verify privileges on staging and production after applying (query `has_function_privilege`).
- `recordCoinTransaction` signature unchanged; it never throws. Clamp semantics (floor at zero) preserved for earns and `admin_deduct`.
- Error copy returned by web actions is unchanged (exact strings listed per task).
- Web behaviour must not change except where the spec says so; each extraction is preceded by a characterization test.
- Idempotency-Key required on `POST /store/{itemId}/purchase`; `equip`/`unequip` are naturally idempotent.
- DB tests run only against staging `ofxmoxpvwbemfouaowoa`, guarded by a URL check. Staging env: `(set -a; . <(tr -d '\r' < .env.development.local); set +a; …)` (the file is CRLF; `.env.local` is PRODUCTION and must never be used for these tests).
- Run tests with `node node_modules/vitest/vitest.mjs run <file>`; typecheck `node node_modules/typescript/bin/tsc --noEmit`; use the Write tool or Edit tool for source edits (a long shell heredoc truncated a file in 6a).

## Review Focus

- 20 parallel purchases of the same item by one player yield exactly one ownership row and one ledger debit. Pinned in Task 2.
- A purchase with too little balance writes nothing (no ledger row, no ownership). Pinned in Tasks 2 and 5.
- Changing a wager's stake never leaves a refunded stake without a wager row, and a failed save reverses exactly the net change. Pinned in Task 4.
- A deduction larger than the balance still clamps to zero for `admin_deduct`, and an RPC failure is never reported as "not enough coins". Pinned in Tasks 3 and 4.
- Unequip clears `profiles.equipped_avatar_border` / `equipped_bubble_skin` through the existing triggers. Pinned in Task 2.
- `GET /store` never returns ownership or balance without a valid bearer, and `previewUrl` is always absolute. Pinned in Task 6.

---

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/migrations/20261011130000_coin_atomic_and_store_functions.sql` | `coin_apply`, `store_purchase`, `store_equip` |
| `lib/coins/atomic.staging.test.ts` | Concurrency proof on staging only |
| `lib/coins/service.ts` (+ `service.test.ts`) | `recordCoinTransaction` → rpc; new `spendCoins` |
| `lib/community/post-service.ts`, `lib/tournaments/register-service.ts`, `lib/wagers/place-wager-service.ts` | Spenders on `spendCoins` |
| `lib/friendly-matches/coin-stake.ts` (+ test), `pay-actions.ts` | Extracted coin stake |
| `lib/store/purchase-service.ts`, `equip-service.ts`, `catalogue.ts` (+ tests) | Shared store logic |
| `lib/coins/actions.ts` | Web shells |
| `lib/mobile-api/endpoints/store.ts` (+ test), `app/api/mobile/v1/store/**/route.ts` | Four operations |
| `lib/wallet/overview.ts`, `endpoints/wallet.ts`, `endpoints/me.ts` | Additive `coinBalance`; `usernameColour`/`profileTheme` on `/me` |

---

### Task 1: Branch and spec

- [ ] **Step 1:** Create `phase6b/store-web` from `docs/phase6b-store-spec` (carries the spec and this plan). Confirm `git status` is clean apart from the existing untracked folders.

---

### Task 2: Atomic SQL functions

**Files:**
- Create: `supabase/migrations/20261011130000_coin_atomic_and_store_functions.sql`
- Create: `lib/coins/atomic.staging.test.ts`
- Modify: `lib/supabase/types.ts` (Functions block)

**Interfaces — Produces:**
- `coin_apply(p_player uuid, p_delta integer, p_source text, p_reference uuid, p_description text, p_clamp boolean) RETURNS integer` — new balance, or `NULL` (strict mode only) when the debit would overdraw; nothing written then.
- `store_purchase(p_player uuid, p_item uuid) RETURNS jsonb` — `{"status":"ok","balance":N}` | `{"status":"not_found"}` | `{"status":"inactive"}` | `{"status":"owned"}` | `{"status":"insufficient","balance":N}`.
- `store_equip(p_player uuid, p_item uuid, p_equipped boolean) RETURNS jsonb` — `{"status":"ok","category":"…"}` | `{"status":"not_found"}` | `{"status":"not_owned"}`.

- [ ] **Step 1: Write the migration**

```sql
-- Atomic coin balance changes and store purchase/equip. Replaces the read-modify-write in
-- lib/coins/service.ts and the hand-rolled purchase in lib/coins/actions.ts. Service-role only.
CREATE OR REPLACE FUNCTION public.coin_apply(
  p_player      uuid,
  p_delta       integer,
  p_source      text,
  p_reference   uuid,
  p_description text,
  p_clamp       boolean
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old     integer;
  v_new     integer;
  v_applied integer;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'coin_apply: delta must not be zero';
  END IF;

  INSERT INTO sx_coins (player_id) VALUES (p_player) ON CONFLICT (player_id) DO NOTHING;
  -- The row lock serialises every coin change for this player.
  SELECT balance INTO v_old FROM sx_coins WHERE player_id = p_player FOR UPDATE;

  IF p_clamp THEN
    v_new := greatest(0, v_old + p_delta);          -- today's behaviour: floor at zero
  ELSE
    v_new := v_old + p_delta;
    IF v_new < 0 THEN
      RETURN NULL;                                    -- strict: refuse an overdraft, write nothing
    END IF;
  END IF;
  v_applied := v_new - v_old;

  UPDATE sx_coins
     SET balance      = v_new,
         total_earned = total_earned + greatest(0, v_applied),
         total_spent  = total_spent  + greatest(0, -v_applied),
         updated_at   = now()
   WHERE player_id = p_player;

  INSERT INTO sx_coin_transactions (player_id, amount, balance_after, source, reference_id, description)
  VALUES (p_player, v_applied, v_new, p_source, p_reference, p_description);

  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.store_purchase(p_player uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item    store_items%ROWTYPE;
  v_balance integer;
BEGIN
  SELECT * INTO v_item FROM store_items WHERE id = p_item FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF NOT v_item.active THEN RETURN jsonb_build_object('status', 'inactive'); END IF;

  -- Lock this player's coin row first: concurrent purchases by the same player queue up here, so the
  -- ownership check below cannot be raced.
  INSERT INTO sx_coins (player_id) VALUES (p_player) ON CONFLICT (player_id) DO NOTHING;
  PERFORM 1 FROM sx_coins WHERE player_id = p_player FOR UPDATE;

  IF EXISTS (SELECT 1 FROM player_store_items WHERE player_id = p_player AND item_id = p_item) THEN
    RETURN jsonb_build_object('status', 'owned');
  END IF;

  v_balance := coin_apply(p_player, -v_item.price_coins, 'store_purchase', p_item, v_item.name, false);
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('status', 'insufficient',
      'balance', (SELECT balance FROM sx_coins WHERE player_id = p_player));
  END IF;

  INSERT INTO player_store_items (player_id, item_id) VALUES (p_player, p_item);
  RETURN jsonb_build_object('status', 'ok', 'balance', v_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.store_equip(p_player uuid, p_item uuid, p_equipped boolean) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category text;
BEGIN
  SELECT category INTO v_category FROM store_items WHERE id = p_item;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  IF NOT EXISTS (SELECT 1 FROM player_store_items WHERE player_id = p_player AND item_id = p_item) THEN
    RETURN jsonb_build_object('status', 'not_owned');
  END IF;

  IF p_equipped THEN
    -- One statement: this item on, every other owned item of the category off.
    UPDATE player_store_items psi
       SET equipped = (psi.item_id = p_item)
      FROM store_items si
     WHERE si.id = psi.item_id AND psi.player_id = p_player AND si.category = v_category;
  ELSE
    UPDATE player_store_items SET equipped = false WHERE player_id = p_player AND item_id = p_item;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'category', v_category);
END;
$$;

REVOKE ALL ON FUNCTION public.coin_apply(uuid, integer, text, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_purchase(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_equip(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coin_apply(uuid, integer, text, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_purchase(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_equip(uuid, uuid, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Write the staging-only test (RED first)** `lib/coins/atomic.staging.test.ts`. Guard with `describe.skipIf(!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('ofxmoxpvwbemfouaowoa'))`, create the admin client **inside `beforeAll`** (a file-level client broke the default suite in 6a), create one throwaway `zzqa+coin<ts>@example.com` user in `beforeAll` and delete it in `afterAll`. Seed 1000 coins with `coin_apply(..., clamp true)`. Look up the staging item ids once in `beforeAll` into `bronzeId` (`avatar_border_bronze`, 150), `purpleId` (`avatar_border_purple_glow`, 300) and `goldNameId` (`username_gold`, 150). Tests:

```ts
it('20 parallel mixed credits and strict debits never lose an update', async () => {
  const calls = Array.from({ length: 20 }, (_, i) =>
    admin.rpc('coin_apply', { p_player: playerId, p_delta: i % 2 === 0 ? 50 : -30, p_source: i % 2 === 0 ? 'admin_grant' : 'friendly_stake', p_reference: null, p_description: null, p_clamp: i % 2 === 0 }))
  const results = await Promise.all(calls)
  expect(results.every((r) => !r.error)).toBe(true)
  const { data } = await admin.from('sx_coins').select('balance, total_earned, total_spent').eq('player_id', playerId).single()
  expect(data!.balance).toBe(1000 + 10 * 50 - 10 * 30)
  expect(data!.total_earned - data!.total_spent).toBe(data!.balance)
})

it('strict mode refuses an overdraft and writes nothing; clamp mode floors at zero', async () => {
  const balance = async () => (await admin.from('sx_coins').select('balance').eq('player_id', playerId).single()).data!.balance
  const ledger = async () => (await admin.from('sx_coin_transactions').select('id', { count: 'exact', head: true }).eq('player_id', playerId)).count
  const before = await balance()
  const rows = await ledger()
  const strict = await admin.rpc('coin_apply', { p_player: playerId, p_delta: -(before + 1), p_source: 'friendly_stake', p_reference: null, p_description: null, p_clamp: false })
  expect(strict.error).toBeNull()
  expect(strict.data).toBeNull()
  expect(await balance()).toBe(before)
  expect(await ledger()).toBe(rows)
  const clamped = await admin.rpc('coin_apply', { p_player: playerId, p_delta: -(before + 500), p_source: 'admin_deduct', p_reference: null, p_description: null, p_clamp: true })
  expect(clamped.data).toBe(0)
  const last = (await admin.from('sx_coin_transactions').select('amount, balance_after').eq('player_id', playerId).order('created_at', { ascending: false }).limit(1).single()).data!
  expect(last).toEqual({ amount: -before, balance_after: 0 })
  await admin.rpc('coin_apply', { p_player: playerId, p_delta: 1000, p_source: 'admin_grant', p_reference: null, p_description: 'reseed', p_clamp: true })
})

it('20 parallel purchases of one item: exactly one ok, nineteen owned, one debit', async () => {
  const before = (await admin.from('sx_coins').select('balance').eq('player_id', playerId).single()).data!.balance
  const results = await Promise.all(Array.from({ length: 20 }, () => admin.rpc('store_purchase', { p_player: playerId, p_item: bronzeId })))
  const statuses = results.map((r) => (r.data as { status: string }).status)
  expect(statuses.filter((s) => s === 'ok')).toHaveLength(1)
  expect(statuses.filter((s) => s === 'owned')).toHaveLength(19)
  const after = (await admin.from('sx_coins').select('balance').eq('player_id', playerId).single()).data!.balance
  expect(after).toBe(before - 150)
  const { count } = await admin.from('player_store_items').select('id', { count: 'exact', head: true }).eq('player_id', playerId).eq('item_id', bronzeId)
  expect(count).toBe(1)
  const { count: debits } = await admin.from('sx_coin_transactions').select('id', { count: 'exact', head: true }).eq('player_id', playerId).eq('source', 'store_purchase').eq('reference_id', bronzeId)
  expect(debits).toBe(1)
})

it('a purchase with too little balance writes nothing', async () => {
  const bal = (await admin.from('sx_coins').select('balance').eq('player_id', playerId).single()).data!.balance
  await admin.rpc('coin_apply', { p_player: playerId, p_delta: -(bal - 100), p_source: 'friendly_stake', p_reference: null, p_description: null, p_clamp: false }) // leave 100 (< 300)
  const ledgerBefore = (await admin.from('sx_coin_transactions').select('id', { count: 'exact', head: true }).eq('player_id', playerId)).count
  const res = await admin.rpc('store_purchase', { p_player: playerId, p_item: purpleId })
  expect(res.data).toEqual({ status: 'insufficient', balance: 100 })
  const { count: owned } = await admin.from('player_store_items').select('id', { count: 'exact', head: true }).eq('player_id', playerId).eq('item_id', purpleId)
  expect(owned).toBe(0)
  expect((await admin.from('sx_coin_transactions').select('id', { count: 'exact', head: true }).eq('player_id', playerId)).count).toBe(ledgerBefore)
  await admin.rpc('coin_apply', { p_player: playerId, p_delta: 5000, p_source: 'admin_grant', p_reference: null, p_description: 'reseed', p_clamp: true })
})

it('equip swaps the category in one step; unequip clears the profile column through the trigger', async () => {
  expect((await admin.rpc('store_purchase', { p_player: playerId, p_item: purpleId })).data).toMatchObject({ status: 'ok' })
  expect((await admin.rpc('store_purchase', { p_player: playerId, p_item: goldNameId })).data).toMatchObject({ status: 'ok' })
  const border = async () => (await admin.from('profiles').select('equipped_avatar_border').eq('id', playerId).single()).data!.equipped_avatar_border
  const equippedIds = async () => ((await admin.from('player_store_items').select('item_id').eq('player_id', playerId).eq('equipped', true)).data ?? []).map((r) => r.item_id).sort()

  expect((await admin.rpc('store_equip', { p_player: playerId, p_item: bronzeId, p_equipped: true })).data).toEqual({ status: 'ok', category: 'avatar_border' })
  expect(await border()).toBe('avatar_border_bronze')
  await admin.rpc('store_equip', { p_player: playerId, p_item: purpleId, p_equipped: true })
  expect(await border()).toBe('avatar_border_purple_glow')
  expect(await equippedIds()).toEqual([purpleId]) // bronze was swapped off in the same step
  await admin.rpc('store_equip', { p_player: playerId, p_item: goldNameId, p_equipped: true })
  expect(await border()).toBe('avatar_border_purple_glow') // another category leaves the border alone
  expect(await equippedIds()).toEqual([purpleId, goldNameId].sort())
  expect((await admin.rpc('store_equip', { p_player: playerId, p_item: purpleId, p_equipped: false })).data).toEqual({ status: 'ok', category: 'avatar_border' })
  expect(await border()).toBeNull()
  expect(await equippedIds()).toEqual([goldNameId])
})

it('not_found and not_owned', async () => {
  const ghost = '00000000-0000-4000-8000-000000000999'
  expect((await admin.rpc('store_purchase', { p_player: playerId, p_item: ghost })).data).toEqual({ status: 'not_found' })
  expect((await admin.rpc('store_equip', { p_player: playerId, p_item: ghost, p_equipped: true })).data).toEqual({ status: 'not_found' })
  const { data: other } = await admin.from('store_items').select('id').eq('slug', 'avatar_border_champion').single()
  expect((await admin.rpc('store_equip', { p_player: playerId, p_item: other!.id, p_equipped: true })).data).toEqual({ status: 'not_owned' })
})
```

- [ ] **Step 3: Run it red** against staging: `(set -a; . <(tr -d '\r' < .env.development.local); set +a; node node_modules/vitest/vitest.mjs run lib/coins/atomic.staging.test.ts)`. Expected: FAIL, "Could not find the function public.coin_apply".
- [ ] **Step 4:** Ask the owner to approve applying the migration to **staging** (`mcp__claude_ai_Supabase__apply_migration`, project `ofxmoxpvwbemfouaowoa`, name `coin_atomic_and_store_functions`); apply it. Re-run the test. Expected: all pass. Then verify with SQL that `anon` and `authenticated` cannot execute any of the three functions and `service_role` can, and that no `zzqa+coin` user is left.
- [ ] **Step 5:** Add the three `Functions` entries to `lib/supabase/types.ts` (args exactly as above; `coin_apply` returns `number | null`, the other two `Json`). Run `tsc --noEmit`.
- [ ] **Step 6: Commit** `feat(coins): atomic coin_apply, store_purchase and store_equip`.

---

### Task 3: `recordCoinTransaction` and `spendCoins` on `coin_apply`

**Files:** Modify `lib/coins/service.ts`, rewrite `lib/coins/service.test.ts`.

**Interfaces — Produces:**
- `recordCoinTransaction(admin, playerId, amount, source, referenceId, description?) => Promise<number | null>` — clamp mode; the new balance, or `null` if the call failed. Never throws.
- `spendCoins(admin, playerId, amount, source, referenceId, description?) => Promise<{ ok: true; balance: number } | { ok: false; reason: 'insufficient' | 'unavailable' }>` — strict; `amount` is a positive number of coins to spend.
- `getCoinBalance` unchanged.

- [ ] **Step 1: Failing tests** (replace the table-fake with an `rpc` fake):

```ts
const fakeAdmin = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as never

describe('recordCoinTransaction', () => {
  it('calls coin_apply in clamp mode and returns the new balance', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 120, error: null })
    expect(await recordCoinTransaction(fakeAdmin(rpc), 'p1', 20, 'match_played', 'm1', 'd')).toBe(120)
    expect(rpc).toHaveBeenCalledWith('coin_apply', { p_player: 'p1', p_delta: 20, p_source: 'match_played', p_reference: 'm1', p_description: 'd', p_clamp: true })
  })
it('passes a negative amount through in clamp mode (admin deduction)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 0, error: null })
    expect(await recordCoinTransaction(fakeAdmin(rpc), 'p1', -100, 'admin_deduct', null)).toBe(0)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_delta: -100, p_clamp: true })
  })
it('resolves to null, logs, and never throws when the rpc errors or throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const errored = vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } })
    const thrown = vi.fn().mockRejectedValue(new Error('network'))
    expect(await recordCoinTransaction(fakeAdmin(errored), 'p1', 20, 'match_played', null)).toBeNull()
    expect(await recordCoinTransaction(fakeAdmin(thrown), 'p1', 20, 'match_played', null)).toBeNull()
  })
it('maps an undefined description to null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 5, error: null })
    await recordCoinTransaction(fakeAdmin(rpc), 'p1', 5, 'daily_login', null)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_description: null, p_reference: null })
  })
})

describe('spendCoins', () => {
it('calls coin_apply strictly with a negative delta', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 850, error: null })
    expect(await spendCoins(fakeAdmin(rpc), 'p1', 150, 'store_purchase', 'item1', 'Gold Crown')).toEqual({ ok: true, balance: 850 })
    expect(rpc).toHaveBeenCalledWith('coin_apply', { p_player: 'p1', p_delta: -150, p_source: 'store_purchase', p_reference: 'item1', p_description: 'Gold Crown', p_clamp: false })
  })
it('reports insufficient when coin_apply returns null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    expect(await spendCoins(fakeAdmin(rpc), 'p1', 150, 'store_purchase', null)).toEqual({ ok: false, reason: 'insufficient' })
  })
it('reports unavailable, not insufficient, when the rpc errors or throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const errored = vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } })
    const thrown = vi.fn().mockRejectedValue(new Error('network'))
    expect(await spendCoins(fakeAdmin(errored), 'p1', 150, 'store_purchase', null)).toEqual({ ok: false, reason: 'unavailable' })
    expect(await spendCoins(fakeAdmin(thrown), 'p1', 150, 'store_purchase', null)).toEqual({ ok: false, reason: 'unavailable' })
  })
it('rejects a non-positive amount without calling the database', async () => {
    const rpc = vi.fn()
    expect(await spendCoins(fakeAdmin(rpc), 'p1', 0, 'store_purchase', null)).toEqual({ ok: false, reason: 'unavailable' })
    expect(await spendCoins(fakeAdmin(rpc), 'p1', -5, 'store_purchase', null)).toEqual({ ok: false, reason: 'unavailable' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2:** Run `lib/coins/service.test.ts` → FAIL (old code uses `.from`).
- [ ] **Step 3: Implement** (keep `getCoinBalance`):

```ts
export async function recordCoinTransaction(admin: Admin, playerId: string, amount: number, source: string, referenceId: string | null, description?: string): Promise<number | null> {
  try {
    const { data, error } = await admin.rpc('coin_apply', { p_player: playerId, p_delta: amount, p_source: source, p_reference: referenceId, p_description: description ?? null, p_clamp: true })
    if (error || data == null) { console.error('[coins] record failed', { source, message: error?.message }); return null }
    return data
  } catch (err) { console.error('[coins] record threw', { source, message: err instanceof Error ? err.message : String(err) }); return null }
}

export type SpendCoinsResult = { ok: true; balance: number } | { ok: false; reason: 'insufficient' | 'unavailable' }

export async function spendCoins(admin: Admin, playerId: string, amount: number, source: string, referenceId: string | null, description?: string): Promise<SpendCoinsResult> {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'unavailable' }
  try {
    const { data, error } = await admin.rpc('coin_apply', { p_player: playerId, p_delta: -amount, p_source: source, p_reference: referenceId, p_description: description ?? null, p_clamp: false })
    if (error) { console.error('[coins] spend failed', { source, message: error.message }); return { ok: false, reason: 'unavailable' } }
    if (data == null) return { ok: false, reason: 'insufficient' }
    return { ok: true, balance: data }
  } catch (err) { console.error('[coins] spend threw', { source, message: err instanceof Error ? err.message : String(err) }); return { ok: false, reason: 'unavailable' } }
}
```

- [ ] **Step 4:** Run the focused test green, then `node node_modules/vitest/vitest.mjs run --maxWorkers=2` and `tsc --noEmit`. Any other test that faked `from('sx_coins')` must be re-pointed at `rpc` (do not loosen assertions). Record the full-suite count in the ledger.
- [ ] **Step 5: Commit** `feat(coins): route coin changes through coin_apply; add spendCoins`.

---

### Task 4: Move the four spenders onto `spendCoins`

**Files:** Modify `lib/community/post-service.ts`, `lib/tournaments/register-service.ts`, `lib/wagers/place-wager-service.ts`, `lib/friendly-matches/pay-actions.ts`; create `lib/friendly-matches/coin-stake.ts` (+ test); update `lib/tournaments/register-service.test.ts`, `lib/wagers/place-wager-service.test.ts`; create `lib/community/boost-service.test.ts`.

**Interfaces:**
- Consumes: `spendCoins`, `recordCoinTransaction` (Task 3).
- Produces: `payCoinStake(admin, args: { playerId: string; matchId: string; stake: number }) => Promise<{ ok: true } | { ok: false; reason: 'insufficient' | 'unavailable' }>`.

- [ ] **Step 1: Boost — failing test** (`lib/community/boost-service.test.ts`, mock `@/lib/coins/service` with `spendCoins`, `recordCoinTransaction`, `getCoinBalance` unused): `performBoostPost` with `spendCoins → insufficient` returns `{ ok:false, errorCode:'insufficient_coins' }` and never updates the post; `unavailable` returns `boost_failed`; success calls `spendCoins(admin, userId, BOOST_COST_COINS, 'post_boost', postId, 'Boosted a community post')` then updates `boosted_until`; a failed post update calls `recordCoinTransaction(admin, userId, BOOST_COST_COINS, 'post_boost', postId, 'Boost failed — auto-reversed')` and returns `boost_failed`. Use `fakeSupabase` (`lib/testing/fake-supabase.ts`) for `community_posts`. Run red, then implement: delete the `getCoinBalance` pre-check and `balance < BOOST_COST_COINS` branch; replace the debit with the `spendCoins` call and the two mappings above.
- [ ] **Step 2: Entry discount — update tests first.** In `register-service.test.ts` change the mocked module to `{ getCoinBalance: vi.fn(), recordCoinTransaction: vi.fn(), spendCoins: vi.fn() }`. Rewrite: "rejects a coin discount when the balance is insufficient" → `spendCoins.mockResolvedValue({ ok:false, reason:'insufficient' })` expects `insufficient_coins` and that no registration row is written; "confirms immediately when a full coin discount brings the fee to zero" → `spendCoins.mockResolvedValue({ ok:true, balance: 1000 })`, expects `spendCoins` called with `(expect.anything(), 'u1', 1000, 'entry_discount', 't1', expect.any(String))`; add "`unavailable` is reported as `registration_failed`, not insufficient"; "ignores an out-of-range coinsUsed" asserts `spendCoins` not called. Run red; implement: replace the balance pre-check and `recordCoinTransaction(-n)` with one `spendCoins`, mapping `insufficient` → `insufficient_coins` and `unavailable` → `registration_failed`.
- [ ] **Step 3: Friendly coin stake.** Test `coin-stake.test.ts`: `payCoinStake` calls `spendCoins(admin, playerId, stake, 'friendly_stake', matchId, 'Friendly stake — match <id>')` and maps its results through unchanged. Implement the helper; in `pay-actions.ts` replace the inline balance check and debit with `payCoinStake`, mapping `insufficient` → `'Not enough SX Coins for this stake.'` and `unavailable` → `'Could not take the stake. Please try again.'`; leave the status update below it unchanged.
- [ ] **Step 4: Wager — update tests first** (`place-wager-service.test.ts`: mock `{ getCoinBalance, recordCoinTransaction, spendCoins }`). New expectations:
  - fresh wager (previous 0, stake 100): `spendCoins(admin,'u3',100,'wager_stake','m1','Wager — match m1')`, then upsert.
  - raise 100→150: **one** `spendCoins(admin,'u3',50,'wager_stake','m1','Wager — match m1')`; no refund call.
  - lower 150→100: upsert first, then `recordCoinTransaction(admin,'u3',50,'wager_refund','m1','Wager changed — stake reduced')`.
  - same stake: no coin call at all.
  - `insufficient` → `insufficient_coins` and the upsert is **not** called; `unavailable` → `wager_failed`.
  - upsert fails after a raise: `recordCoinTransaction(admin,'u3',<net spent>,'wager_refund','m1','Wager save failed — auto-reversed')`; upsert fails on a lower: no coin was moved yet, so no reversal is needed.
  Implement: `delta = previousStake - stake`. `delta < 0` → `spendCoins(-delta)` first, then upsert, reversing exactly `-delta` on failure; `delta > 0` → upsert first, then credit `delta`; `delta === 0` → upsert only. Remove the `getCoinBalance` pre-check.
- [ ] **Step 5:** Run `lib/community lib/tournaments lib/wagers lib/friendly-matches lib/mobile-api` green, then the full suite and `tsc --noEmit`. Commit `refactor(coins): boost, discount, wager and friendly stake spend atomically`.

---

### Task 5: Store services and web shells

**Files:** Create `lib/store/purchase-service.ts`, `lib/store/equip-service.ts`, `lib/store/catalogue.ts` and their tests; modify `lib/coins/actions.ts`.

**Interfaces — Produces:**

```ts
export type PurchaseResult =
  | { ok: true; balance: number }
  | { ok: false; reason: 'not_found' | 'inactive' | 'owned' | 'insufficient' | 'unavailable' | 'pending_deletion' }
export function purchaseItem(admin: Admin, args: { playerId: string; itemId: string }): Promise<PurchaseResult>

export type EquipResult =
  | { ok: true; category: string }
  | { ok: false; reason: 'not_found' | 'not_owned' | 'unavailable' }
export function setItemEquipped(admin: Admin, args: { playerId: string; itemId: string; equipped: boolean }): Promise<EquipResult>

export interface StoreItemView { id: string; slug: string; name: string; description: string | null; category: string; priceCoins: number; previewUrl: string; owned: boolean; equipped: boolean }
export function loadStore(admin: Admin, args: { playerId: string | null }): Promise<{ ok: true; balance: number | null; items: StoreItemView[] } | { ok: false }>
```

- [ ] **Step 1: Characterize.** `purchase-service.test.ts` with fakes (`fakeSupabase` with `rpc` fixture for `store_purchase`; `assertNotPendingDeletion` mocked): `ok` returns the balance; each status maps to its reason; a restricted account returns `pending_deletion` **without** calling the rpc; an rpc error is `unavailable`, never `insufficient`. `equip` likewise (including `equipped:false` passes `p_equipped:false`). `catalogue.test.ts`: active items only, ordered by category then `sort_order`; `previewUrl` is `SITE_URL + path` for site-relative paths and untouched for absolute ones; signed out → `balance: null` and every `owned/equipped` false; signed in → ownership and equipped from `player_store_items` of **that player only** (include a stranger's rows in the fixture); balance from `sx_coins`; a read error → `{ ok:false }`.
- [ ] **Step 2:** Run red; implement the three modules (`rpc('store_purchase', { p_player, p_item })`, etc.).
- [ ] **Step 3: Rewire `lib/coins/actions.ts`** to shells: `purchaseStoreItem` calls `purchaseItem` and maps reasons to the **existing strings** — `not_found` "Item not found.", `inactive` "This item is no longer available.", `owned` "You already own this item.", `insufficient` "Not enough SX Coins.", `unavailable` "Could not complete the purchase. Please try again.", `pending_deletion` the shared restriction message; `equipStoreItem` calls `setItemEquipped(..., true)` mapping `not_owned` "You do not own this item.", `not_found` "Item not found.". Keep `revalidatePath` calls. `decide.ts` and its test stay (still used by tests) or are deleted with their test if nothing imports them — grep first.
- [ ] **Step 4:** Focused tests green, full suite and `tsc --noEmit` green. Commit `refactor(store): shared purchase, equip and catalogue services`.

---

### Task 6: Endpoints and additive fields

**Files:** Create `lib/mobile-api/endpoints/store.ts` (+ `store.test.ts`), `app/api/mobile/v1/store/route.ts`, `store/[itemId]/purchase/route.ts`, `store/[itemId]/equip/route.ts`, `store/[itemId]/unequip/route.ts`; modify `endpoints/index.ts`, `lib/wallet/overview.ts` (+ test), `endpoints/wallet.ts` (+ test), `endpoints/me.ts` (+ test).

**Interfaces — Produces:** operationIds `getStore`, `purchaseStoreItem`, `equipStoreItem`, `unequipStoreItem`; `WalletOverview.coinBalance: number`; `/me` profile gains `usernameColour: string | null` and `profileTheme: string | null`.

- [ ] **Step 1: Failing endpoint tests** (`store.test.ts`, mocks like `wallet.test.ts`: hoisted `authenticate`, `optionalAuth`, `runIdempotent` passthrough, service mocks):
  - `getStore` signed out (`optionalAuth` → null): 200, `balance: null`, no `owned`/`equipped` true; signed in: services called with `ctx.userId`; `previewUrl` absolute; load failure → 500 `store_load_failed`.
  - `purchaseStoreItem`: missing `Idempotency-Key` → 400 `idempotency_key_required`; success returns `{ balance, itemId }` and `runIdempotent` is keyed by `{ key, userId, route: '/api/mobile/v1/store/<id>/purchase' }`; reason map `not_found` 404, `inactive` 409 `item_unavailable`, `owned` 409 `already_owned`, `insufficient` 422 `insufficient_coins`, `unavailable` 503 `store_unavailable`, `pending_deletion` 403 `account_pending_deletion`; a replayed key returns the stored body with no second service call.
  - `equipStoreItem` / `unequipStoreItem`: `not_found` 404, `not_owned` 409 `not_owned`, `unavailable` 503; success `{ itemId, category }`; both require sign-in (401 when `authenticate` rejects); unequip passes `equipped:false`.
  - The `{itemId}` must be a UUID; a malformed id is 404 `not_found` before any service call.
- [ ] **Step 2:** Run red; implement `store.ts` with `defineEndpoint` (`getStore` `auth: 'public'` using `ctx?.userId ?? null` and `createAdminClient()` for the public catalogue read; the three writes `auth: 'user'`, purchase `idempotent: true`) and the four route files (`export const GET/POST = xEndpoint.handler`); register in `ALL_ENDPOINTS`.
- [ ] **Step 3: `coinBalance` on the wallet overview.** Extend the `overview.test.ts` fixtures with an `sx_coins` table (owner 1,250 and a stranger 99,999) and assert `coinBalance === 1250`, `0` for a player with no row, and a read error → `load_failed`; add `sx_coins` to the `Promise.all` in `loadWalletOverview`; add `coinBalance: z.number().int()` to the `getMyWallet` response schema and its endpoint test.
- [ ] **Step 4: `/me` cosmetics.** Read `me.ts` and `me.test.ts`; add a test that a player with an equipped `username_gold` and `theme_neon_grid` gets `usernameColour: 'username_gold'`, `profileTheme: 'theme_neon_grid'` and `null`/`null` when nothing is equipped (stranger rows in the fixture must not leak); implement with one query on `player_store_items` joined to `store_items` for `ctx.userId` and the existing `equippedCosmeticsBySlug`; extend the response schema (nullable strings).
- [ ] **Step 5:** Run `lib/mobile-api` green except the OpenAPI snapshot (Task 7), `tsc --noEmit`, lint. Commit `feat(mobile-api): store endpoints, coinBalance and me cosmetics`.

---

### Task 7: Contract, gate and rollout

- [ ] **Step 1:** `node node_modules/vitest/vitest.mjs run lib/mobile-api/openapi.test.ts -u`. Inspect the diff: it must add only the four store operations, `coinBalance`, and the two `/me` fields (no deletions). Commit `chore(openapi): store operations`.
- [ ] **Step 2: Cold read** the whole diff against the spec: every query scoped by `ctx.userId`; no `.from('sx_coins').upsert/update` left in `lib/` or `app/` (`grep -rn "from('sx_coins')" lib app | grep -v select`); `recordCoinTransaction` never throws; web action strings unchanged; no secrets in logs.
- [ ] **Step 3:** `git fetch origin main`, rebase. Run the full `node node_modules/vitest/vitest.mjs run --maxWorkers=2`, `tsc --noEmit`, `next lint`, and the staging-configured `next build` (`(set -a; . <(tr -d '\r' < .env.development.local); set +a; node node_modules/next/dist/bin/next build)`). Expected: all green, exit 0.
- [ ] **Step 4: Rollout order (do not reorder; ask the owner before step b).** (a) Migration already on staging (Task 2). (b) Apply the same migration to **production** before deploying (it only adds three unused functions); verify `has_function_privilege` for `anon`/`authenticated` is false and `service_role` true. (c) Merge `phase6b/store-web` `--no-ff` into `main`, confirm `git diff` between the merge and the tested branch is empty, push. (d) Record the slice in the ledger and tell mobile the contract is ready.
