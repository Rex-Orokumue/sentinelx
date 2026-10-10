# Mobile Phase 6d — Referrals

Status: implementation design, 2026-10-10. The mobile master spec §8.16 and the current web referrals page define the feature. Phase 6e is complete apart from physical-device verification. Phase 6d precedes 6a Wallet.

## Goal

Give a signed-in player the complete `/dashboard/referrals` surface in the app: their current referral code and shareable signup link, total and converted counts, coins earned, next milestone, invited players and statuses, and milestone award history. Preserve a referral code across an installed-app signup and a Play Store install when the install link carries it. Conversion and awards remain server-owned.

## Ground truth (web `main`, 2026-10-10)

| Fact | Source |
|---|---|
| The referral code is the current username; the share URL is `${SITE_URL}/signup?ref=${username}`. `SITE_URL` defaults to `https://sentinelxesports.com.ng`. A changed username changes the link. | `components/dashboard/ReferralPanel.tsx`, `lib/seo/site.ts` |
| The web page reads the signed-in player's username, referrals filtered by `referrer_id`, their referral coin transactions, milestone transactions, and seeded achievement coin rewards. It returns each invite's display name, avatar, membership tier, equipped border, status, conversion/signup date and base coins awarded. | `app/[locale]/dashboard/referrals/page.tsx` |
| `referrals` rows start `pending` at signup; a first paid and non-waived tournament entry converts the row. A legacy player with `profiles.referred_by` but no row can be inserted on conversion. Settlement is best effort and does not fail a paid registration. | `supabase/migrations/073_defer_username_claim.sql`, `lib/referrals/credit.ts` |
| The base award is 250 SX Coins. Milestones occur at 1, 5, 10, 25 and 50 conversions; achievement seeds hold their coin bonuses. The unique achievement insert prevents duplicate milestone awards. | `lib/referrals/constants.ts`, `actions.ts`, `supabase/migrations/063_referral_coin_economy.sql` |
| Web signup passes `ref` into `performSignup`, which stores it in auth metadata; `handle_new_user()` resolves the referrer's username. Invalid codes silently result in no referral without failing signup. | `lib/auth/signup-service.ts`, `supabase/migrations/073_defer_username_claim.sql` |
| Mobile signup already accepts `initialRef`, and its router reads `state.uri.queryParameters['ref']` on `/signup`. The incoming web-link resolver has no `/signup` mapping; Android's manifest does not claim that path. No Play Install Referrer integration exists. | mobile `lib/features/auth/signup_screen.dart`, `lib/router/app_router.dart`, `lib/core/routing/web_links.dart`, `android/app/src/main/AndroidManifest.xml`, `pubspec.yaml` |
| There is no existing mobile referrals endpoint, provider, or screen. Web referral UI copy is hard-coded and has no `messages/*.json` referrals namespace. | web `lib/mobile-api/endpoints/index.ts`, `components/dashboard/ReferralPanel.tsx`; mobile `lib/features/`, `lib/core/l10n/` |

## Contract

Add one authenticated, read-only operation to `/api/mobile/v1`: `getMyReferrals`, `GET /me/referrals` (T2). It uses `ctx.userId` to scope **every** service-role query. No player identifier comes from request parameters. Response:

```json
{
  "username": "player1",
  "shareUrl": "https://sentinelxesports.com.ng/signup?ref=player1",
  "totalReferrals": 2,
  "convertedCount": 1,
  "totalCoinsEarned": 500,
  "nextMilestone": { "count": 5, "bonusCoins": 500 },
  "invited": [{ "id": "uuid", "name": "Friend", "avatarUrl": null, "tier": "recruit", "frameUrl": null, "status": "converted", "date": "ISO-8601", "coinsAwarded": 250 }],
  "milestoneHistory": [{ "id": "uuid", "description": "First Recruit", "coins": 250, "date": "ISO-8601" }]
}
```

`nextMilestone` is `null` after the final threshold. `shareUrl` is `null` if the username is not yet claimed; a player must claim it before sharing. `totalCoinsEarned` sums only `referral_reward` and `referral_milestone` transaction amounts, matching the web page. `date` is `converted_at` for converted rows and `created_at` otherwise. `status` is `pending`, `converted` or `invalid`. A missing profile is 404 `not_found`; a failed read is 500 `referrals_load_failed`. Authentication failures use the standard mobile envelope. No writes or migrations are needed for this endpoint.

Put the shared query and mapping in `lib/referrals/overview.ts`; the web referrals page and the endpoint call it. Characterize the web page's current result before replacing its query. The endpoint adds one route file, one `ALL_ENDPOINTS` entry, and a generated OpenAPI update. The mobile client copies that contract byte-for-byte and adds `getMyReferrals` to `ApiClient.usedOperations`.

## Mobile design

- `/account/referrals` is a signed-in player route reached from the Account hub and from `/dashboard/referrals` web links. Moderators do not receive a player referral entry. Use a feature repository/provider next to the screen; screens read providers and never construct `ApiClient`.
- The screen shows the code and full signup URL, copy and system share actions (including WhatsApp as a share target), counts, milestone progress, invited list with pending/converted/invalid status, and milestone history. Use the server's awards and seeded bonus values; do not calculate or award coins on the device. Show an empty state, retryable load error, and copy/share feedback. At 320–375 px, test en/fr/pcm.
- Add referral copy directly to `app_en.arb` and companion `app_fr.arb`/`app_pcm.arb`, because the web has no referrals message namespace. Run `flutter gen-l10n`; do not edit generated output.
- Map an incoming `https://sentinelxesports.com.ng/signup?ref=...` to `/signup?ref=...`, preserving the query value. Add the signup App Link path to the Android manifest. When a fresh install was launched through Play with a `ref` install-referrer parameter, read that value once, store it locally until signup succeeds, and prefill the same `initialRef` field. An explicit current link takes precedence over a stored install referrer. Clear the stored value after a successful signup. Do not transmit install attribution elsewhere.
- The current public share URL still opens web signup when no app is installed. No live Play listing exists for this app yet, so do not publish an install CTA that would lead to a dead listing. The install-referrer reader is code-ready for a future Play link that carries `ref`; a generic store visit cannot be attributed, so the app does not guess a code. Android package and signing verification for real App Links, and a Play-delivered install, require a device pass.

## Rulings

- **Ruling: one read endpoint returns the full panel.** This matches the existing web page and keeps the client's counts, lists and milestone state consistent. Cost if wrong: refreshing the panel reloads every invite and history row; pagination may later be needed for very large referrers.
- **Ruling: current username is the code.** This matches web signup and the existing trigger. Cost if wrong: a username change invalidates old shared links; a separate permanent code would require a migration and new lookup path.
- **Ruling: show only the web panel's invited-player fields.** The referrer sees no email, phone or other profile data. Cost if wrong: a future privacy requirement may further reduce the display name/avatar fields.
- **Ruling: capture only explicit `ref` values.** Installed App Links win over an older stored install referrer. An install without a Play referrer leaves signup uncredited. Cost if wrong: some organic users who previously clicked a referral may not be attributed.
- **Ruling: do not add a public Play-install CTA before the listing exists.** Keep the working web signup path and ship the install-referrer reader in the app. Cost if wrong: an invited person who chooses to install before signing up must return to the referral link to be credited until store distribution is available.
- **Ruling: referral rewards stay server-owned and cosmetic coin only.** Mobile exposes no money-to-coin purchase route. Cost if wrong: a product request for a different incentive would need a separate policy and implementation review.

## Review focus and verification limits

Tests must cover owner-only query filters, empty data, pending and converted rows, legacy conversion, null username, all five milestones and the finished state, URL encoding, no PII fields, explicit-link precedence, cold-start link handling, stored referrer clearing, and en/fr/pcm narrow layouts. The endpoint must have no write path. Test with fakes; any database write-path test uses staging only. Real Play Install Referrer delivery, Android App Links verification, WhatsApp share target behavior, and Phase 5/6e device passes remain pending physical-device work. No production data will be written or changed in this phase.
