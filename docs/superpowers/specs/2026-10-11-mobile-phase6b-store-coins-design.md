# Mobile Phase 6b — Store, equip, and atomic coins

Status: design for review, 2026-10-11. Master spec §8.14 (Store) and §8.13 (coins) define the screens; this spec defines the API, the data-integrity work, and the cosmetic rendering they need. The owner approved the scope and the two main decisions on 2026-10-11 (see "Decisions"). Nothing here is implemented. Phase 6a (wallet) is shipped; 6b follows the agreed order 6e → 6d → 6a → **6b** → 6c.

## Goal

A signed-in player can browse the coin store in the app, buy a cosmetic with SX Coins, and equip or unequip it, and what they equip shows everywhere they appear: avatar frame (already server-supplied), assistant bubble skin, username colour and profile theme. Every coin balance change becomes atomic in Postgres, so concurrent spends can never lose an update or hand out something on a stale balance.

## Decisions (owner, 2026-10-11)

- **D1 — Atomic coin functions: approved.** `coin_apply` plus a strict `spendCoins`, with `store_purchase` and `store_equip`; all four existing coin spenders move onto it.
- **D2 — Bundle the store art in the app: approved.** The 20 WebP files ship in `assets/store/`; an unknown slug falls back to the server's preview URL.

## Ground truth (web `main`, 2026-10-11)

| Fact | Source |
|---|---|
| Catalogue: 20 active items, all with previews. 10 `avatar_border` (150–5,000 coins), 3 `bubble_skin` (300–600), 3 `profile_theme` (250–800), 4 `username_colour` (150 each). `preview_url` is a site-relative path such as `/coin-items/gold-crown.webp`. | production `store_items` |
| `store_items` and `player_store_items` are publicly readable (`USING (true)`); all writes are service-role. `UNIQUE (player_id, item_id)`. `sx_coins.balance` has `CHECK (balance >= 0)`; `sx_coins` and `sx_coin_transactions` are owner-read only. | migration 052 |
| `purchaseStoreItem` reads the balance, writes `sx_coins`/`sx_coin_transactions` by hand, then inserts ownership and, if the insert hits the unique constraint, writes a compensating refund. `equipStoreItem` unequips the whole category, then equips the item, as two separate statements. There is **no unequip**. | `lib/coins/actions.ts` |
| `recordCoinTransaction` reads the balance, computes `max(0, balance + amount)` and upserts it, then appends a ledger row. Two concurrent writers can overwrite each other. A deduction larger than the balance **clamps to zero** rather than failing (`admin_deduct` relies on that). | `lib/coins/service.ts` |
| Four spenders pre-check the balance and then debit through the clamping function: post boost (`BOOST_COST_COINS`), tournament entry discount, wager stake (with a refund-then-restake dance when a stake changes), and friendly coin stake. | `post-service.ts`, `register-service.ts`, `place-wager-service.ts`, `pay-actions.ts` |
| `profiles.equipped_avatar_border` and `profiles.equipped_bubble_skin` are maintained by triggers on `player_store_items` for insert, update and delete. An unequip (`equipped = false`) is therefore picked up with no extra work. | migrations `20260908074500`, `20260914194555` |
| **No money-to-coin path exists** anywhere in the web code (searched for coin purchase, top-up and pack flows). Store copy can state that coins are earned only. | grep of `lib`, `app`, `components` |
| The app already receives `frameUrl` (a server-resolved URL) wherever a player appears, `bubbleSkinUrl` on `/me`, and `usernameColour` / `profileTheme` slugs on the player profile, but renders **neither** the colour nor the theme. | mobile `players_models.dart`, `models.dart` |
| The web renders username colour and profile theme on the public profile, the dashboard hero and `ProfileHeader`. The web wallet page shows coins and naira together. | `cosmetics.ts` and its call sites |

## Server work (web repo; one migration, staging first)

All functions are `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`. Prove EXECUTE privileges on staging and production exactly as 6a did.

### `coin_apply(p_player uuid, p_delta integer, p_source text, p_reference uuid, p_description text, p_clamp boolean) RETURNS integer`

One transaction, no read-modify-write in the application:

1. Insert a zero `sx_coins` row if there is none and `p_delta > 0`.
2. `p_clamp = true` (today's behaviour): apply `new = greatest(0, balance + delta)`; the applied delta is `new - balance`; update `balance`, `total_earned += max(0, applied)`, `total_spent += max(0, -applied)`.
3. `p_clamp = false` (strict): update only `WHERE balance + p_delta >= 0`; if no row updates, return `NULL` and write nothing.
4. Append the `sx_coin_transactions` row with the applied delta and `balance_after`, in the same transaction.
5. Return the new balance. A zero delta raises.

### `spendCoins` / `recordCoinTransaction` (TypeScript, `lib/coins/service.ts`)

- `recordCoinTransaction(admin, playerId, amount, source, referenceId, description?)` keeps its exact signature and calls `coin_apply` with `p_clamp = true`. Every earner and `admin_deduct` keep today's semantics and gain the lost-update fix with no caller change. It resolves to the new balance, or `null` if the database call failed; it logs and never throws, as today's code never surfaced a failure either. Callers that ignore the result behave exactly as before.
- New `spendCoins(admin, playerId, amount, source, referenceId, description?) => { ok: true; balance } | { ok: false; reason: 'insufficient' | 'unavailable' }` calls `coin_apply` strict with a negative delta. `NULL` is `insufficient`; an RPC error is `unavailable` and is never reported as "not enough coins".

### Moving the four spenders onto `spendCoins`

| Spender | Change | Error mapping (unchanged for callers) |
|---|---|---|
| Post boost | Replace the balance pre-check and debit with one `spendCoins`; the existing credit-back when the post update fails stays. | `insufficient` → `insufficient_coins`; `unavailable` → `boost_failed` |
| Entry discount | Replace the pre-check and debit with one `spendCoins` before the registration write; the abandoned-discount refund cron is untouched. | `insufficient` → `insufficient_coins` |
| Friendly coin stake | Replace pre-check and debit with one `spendCoins`. | `insufficient` → "Not enough SX Coins for this stake." |
| Wager stake | A change of stake becomes **one** net `coin_apply`: `delta = previousStake - newStake`; negative uses strict `spendCoins` (`wager_stake`), positive uses clamp credit (`wager_refund`). Today's refund-then-restake pair can strand a player with a refunded stake and no wager if the second step fails; the net form cannot. The compensating credit when the `match_wagers` upsert fails reverses exactly the net delta. | `insufficient` → `insufficient_coins`; `unavailable` → `wager_failed` |

Existing tests for each spender are characterized first (they already assert the error codes), then re-pointed at fakes whose `rpc` returns the new shapes.

### `store_purchase(p_player uuid, p_item uuid) RETURNS jsonb`

One transaction: lock the `store_items` row `FOR SHARE`; return `{"status":"not_found"}` if missing, `{"status":"inactive"}` if `active = false`, `{"status":"owned"}` if a `player_store_items` row exists; otherwise debit strictly through `coin_apply` (`store_purchase` source, `reference_id` = item id, description = item name) and insert ownership. Insufficient balance returns `{"status":"insufficient","balance":N}`. Success returns `{"status":"ok","balance":N}`. A concurrent duplicate purchase lets exactly one transaction commit; the other sees `owned` after the unique constraint and rolls its debit back (no compensating refund ledger rows exist any more).

### `store_equip(p_player uuid, p_item uuid, p_equipped boolean) RETURNS jsonb`

One transaction. If the player does not own the item return `{"status":"not_owned"}`. When equipping, set `equipped = false` on every owned item of the same category and `equipped = true` on this one; when unequipping, set this one `false`. The existing triggers then refresh `profiles.equipped_*`. Returns `{"status":"ok"}`. Unequipping an item that is not equipped is a no-op `ok`.

The web `purchaseStoreItem` and `equipStoreItem` actions become thin shells over these functions (same error strings), via `lib/store/purchase-service.ts` and `lib/store/equip-service.ts`, so web and mobile share one code path.

## Contract

All under `/api/mobile/v1`. Errors use the standard envelope; amounts are integer coins.

| operationId | Method / path | Notes |
|---|---|---|
| `getStore` | `GET /store` | `auth: 'public'` (the catalogue is public). Returns `{ balance: number\|null, items: [{ id, slug, name, description\|null, category, priceCoins, previewUrl, owned, equipped }] }`, ordered by category then `sort_order`, active items only. `balance`, `owned` and `equipped` are meaningful only when signed in (`null`/`false` otherwise). `previewUrl` is absolute (`SITE_URL` + the stored path). |
| `purchaseStoreItem` | `POST /store/{itemId}/purchase` | `auth: 'user'`, **idempotent** (`Idempotency-Key`). Returns `{ balance, itemId }`. Errors: `not_found` (404), `item_unavailable` (409), `already_owned` (409), `insufficient_coins` (422), `store_unavailable` (503). Pending-deletion accounts get `account_pending_deletion` (403), as other obligation-taking actions do. |
| `equipStoreItem` | `POST /store/{itemId}/equip` | `auth: 'user'`. Returns `{ itemId, category }`. Errors: `not_found`, `not_owned` (409). Safe to repeat, so no `Idempotency-Key`. |
| `unequipStoreItem` | `POST /store/{itemId}/unequip` | Same shape and errors. New capability, not on the web. |

`GET /wallet` (6a) gains an additive `coinBalance: number` read from `sx_coins`, so the Wallet screen can show naira and coins together (master spec §8.12). The OpenAPI document is regenerated; the mobile copy is byte-identical.

## Mobile design

- **Route:** `/account/store`, wrapped in a gate that sends signed-out visitors to a log-in prompt (browsing the catalogue stays possible signed out; buying prompts log-in). Entry: a Store tile in the Account hub. Web `/store` links resolve to it.
- **Screen:** category chips (Borders, Bubble skins, Themes, Name colours), a grid of item cards with the bundled preview, name, price, and an Owned / Equipped badge; a header showing the coin balance and the disclaimer "SX Coins cannot be exchanged for cash. They are earned by competing and spent on the platform." Tapping a card opens a detail sheet: large preview, description, price, then **Buy** (confirm dialog with price and resulting balance), **Equip**, or **Unequip**. State always comes back from the server (refetch after each action); no optimistic ownership.
- **Money rules:** one `Idempotency-Key` per purchase action through `writeFlowProvider`, a fresh key when the item changes, double-tap guarded. Errors map by code to localized copy (never the server message). Insufficient coins shows how many more are needed using the server balance.
- **Bundled art:** `assets/store/` holds the 20 WebP files under their web file names (copied byte-for-byte from `public/coin-items/`). A `CosmeticArt` helper resolves a URL or slug to the bundled asset by **file name** (`/coin-items/gold-crown.webp` → `assets/store/gold-crown.webp`) and falls back to the network URL for names it does not know. `PlayerAvatar` and the assistant's bubble use it, so frames and bubble skins render offline with **no API change**.
- **Username colour and profile theme:** a `CosmeticStyle` helper maps `username_purple|gold|red|teal` to the web's colours (purple-text, amber-400, red-400, teal-400) and `theme_dark_void|neon_grid|lagos_skyline` to native backgrounds (flat black; a violet grid on slate; an orange-to-slate gradient). Applied where the web does: the public player profile and the player's own identity card in the Account hub. Unknown slugs render nothing special, never an error.
- **Copy:** ARB in en/fr/pcm (machine-drafted, as 6a); every `DateFormat` locale through `dateLocale()`; naira and coin amounts through one formatter each. Layout checked at 320 and 375 px in all three languages.
- **Access:** the store is gameplay, not money, so moderators keep it (unlike the wallet).

## Rulings

- **R1 — clamp mode survives for earns and `admin_deduct`.** Changing them to strict would turn an admin deduction larger than the balance into an error. Cost if wrong: callers that want strict behaviour use `spendCoins`.
- **R2 — a wager change posts one net ledger row** instead of a refund row plus a stake row. The ledger therefore shows "Wager — match X" for the difference. Cost if wrong: coin history for edited wagers reads slightly differently; settlement uses `match_wagers.stake_coins`, not the ledger, so payouts are unaffected.
- **R3 — unequip is added** although the web lacks it. Cost if wrong: remove one endpoint and one button.
- **R4 — `GET /store` is public.** The catalogue is already public data; owned and balance fields appear only with a valid bearer. Cost if wrong: make it `auth: 'user'` and add a sign-in wall.
- **R5 — art is matched by file name, not slug.** The server already sends URLs and the bundled files keep the web names, so no payload changes. Cost if wrong: a renamed file on the web falls back to the network copy, never breaks.
- **R6 — `coinBalance` on the wallet overview is additive.** Old clients ignore it. Cost if wrong: none.
- **R7 — no coin-purchase surface and no copy implying one.** There is no ₦→coin path, so the iOS in-app-purchase analysis (§14) stays "earned-only, cosmetic-only". Cost if wrong: re-run the policy review if such a path is ever added.

## Review focus and verification limits

Tests (vitest with fakes; atomicity on **staging only**): `coin_apply` clamp and strict modes, including 20 parallel credits/debits ending at `start + sum(deltas)`; 20 parallel purchases of the same item yield exactly one ownership row, one ledger debit, and 19 `owned`; a purchase with too little balance writes nothing; equip swaps the category in one step and leaves the other categories alone; unequip clears `profiles.equipped_*` through the trigger; each of the four spenders returns its existing error codes and never reports `unavailable` as `insufficient`; `GET /store` hides ownership and balance when signed out; `purchase` replays on the same key and does not double-debit; the OpenAPI diff only adds the new operations and `coinBalance`. Mobile: owned/equipped/insufficient states, double-tap, key rotation on item change, bundled-art resolution with and without a known file name, unknown slug fallbacks, signed-out gate, 320/375 px × en/fr/pcm.

Not verifiable without hardware: real device rendering of the bundled frames at screen densities and the store's feel on a phone. Those wait for the device pass at the end of Phase 6 (owner decision: no device tests before then). No production data is written or changed during development or testing; the migration reaches production only after staging verification and with owner approval.

## Rollout order

1. Migration to staging; run the staging atomicity tests.
2. Migration to production (additive; the new functions are unused until the web deploys); verify EXECUTE is `service_role` only.
3. Merge the web branch to `main` and push.
4. Re-copy the OpenAPI document into the mobile repo (expect no diff).
5. Merge the mobile branch to `master` and push.
