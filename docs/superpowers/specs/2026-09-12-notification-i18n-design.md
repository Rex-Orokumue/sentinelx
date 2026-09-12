# Notification copy in the recipient's locale — design

**Date:** 2026-09-12
**Status:** approved, implementing
**Implements:** §7 of `2026-08-23-multi-language-support-design.md` (i18n Part 8)

## Why

The app renders in en/fr/pcm, but every notification a player receives —
WhatsApp, push, and the in-app bell — is hardcoded English. A player who sets
their language to Pidgin still gets English the moment the message leaves the
page.

## Reach, stated honestly

Measured on production 2026-09-12:

| locale | players |
|---|---|
| en | 113 |
| pcm | 1 |
| fr | 0 |

Translating notifications currently benefits one player. This was put to the
user with the numbers in front of them, twice, and they chose to proceed. It is
recorded here so nobody later mistakes the decision for an oversight.

Two things are worth separating, because only one of them depends on those
numbers:

- **Centralising the copy** is a code-quality win regardless. Notification
  wording is currently typed inline at ~30 call sites, and several messages are
  written out twice — once for push, once for the bell — with the strings
  duplicated by hand (`lib/wagers/settle.ts:71-72` is the clearest example).
- **Translating it** is the half whose value tracks the locale counts.

## Current shape

| Channel | Where copy lives | Verdict |
|---|---|---|
| WhatsApp | `renderTemplate()` in `lib/notifications/templates.ts` — one switch over a discriminated union, 15 types | already central |
| Push | `pushToPlayer(id, type, {title, body}, data)` — title/body built at the call site | scattered |
| In-app | `notifyInApp({playerId, type, title, body, link})` — same | scattered |

30 non-test files call `pushToPlayer` / `notifyInApp` / `broadcastPush`.
`PushNotificationType` has 23 members, the in-app `NotificationType` has ~35,
and they overlap heavily (`result_confirmed`, `post_comment`, `prize_credited`,
`achievement_unlocked`, …) because most call sites send both channels with the
same words.

## Design

### One copy module

`lib/notifications/copy.ts` exports

```ts
renderNotification(input: NotificationInput, t: Translator): { title: string; body: string }
```

over a discriminated union covering every push and in-app type — deliberately
the same shape `templates.ts` already uses, so the codebase has one convention
for notification copy rather than two.

### Locale resolved at the sender, never the actor

A notification renders in the **recipient's** locale. If an English-speaking
admin confirms a result for a `pcm` player, that player's push, bell entry and
WhatsApp message are all Pidgin.

`push.ts` and `inbox.ts` already `SELECT` the recipient's profile row (for
`notification_prefs`), and `notify()` already selects theirs (for
`whatsapp_number`, `country`). Adding `locale` to those existing selects costs
no additional query.

Rendering uses `createTranslator({ locale, messages })` from next-intl, not
`getTranslations()`. `createTranslator` needs no request context, which matters
because these sends happen in cron routes and in deferred work that outlives the
response (see `defer.ts`). Verified available in next-intl 4.13.7. An unknown or
missing locale falls back to `en`.

### Call sites

```diff
- notifyInApp({ playerId, type: 'wager_settled', title: won ? 'Wager won!' : 'Wager settled', body, link })
- pushToPlayer(id, 'wager_settled', { title: won ? 'Wager won!' : 'Wager settled', body }, { url })
+ notifyBoth(playerId, { type: 'wager_settled', won, coins }, { link: `/matches/${matchId}` })
```

`pushToPlayer` and `notifyInApp` remain the primitives, each taking the union
instead of literal strings. `notifyBoth` covers the common case where both are
sent with identical copy today — which is most of them.

### WhatsApp

`templates.ts` keeps its own union and module: its `templateName` values are
tied to Termii/Meta template registration and are not interchangeable with
push/bell types. Only its strings move into the catalog, and `renderTemplate`
gains a `t` parameter.

### Broadcasts

`broadcastPush` sends to everyone, so it cannot render once. It groups
recipients by `profiles.locale` and sends one FCM batch per locale. With today's
data that is two batches.

### Catalog

A new `notifications` namespace in `messages/{en,fr,pcm}.json`, keyed by type.
ICU interpolation for values (`"resultConfirmed": "{playerName}, your result for
{tournamentTitle} was confirmed!"`).

## Decisions worth recording

**In-app history does not retranslate.** `player_notifications` rows persist
`title`/`body` at write time, in the recipient's locale at that moment. Changing
language later leaves old rows as they were. Storing `type` + params and
rendering at read time would fix that, but costs a migration plus read-path
changes for history alone — and "sent is sent" is already how push and WhatsApp
behave.

**Staff notifications follow the same rule.** `noshow_needs_decision`,
`withdrawal_pending`, `result_needs_review` and friends go to admins, and render
in that admin's own locale. No special case needed; recipient's locale already
means the right thing.

## Out of scope

- Per-language WhatsApp template approval from Meta/Termii — an external
  submission process, not a code deliverable. Flagged in §7 of the source spec
  and still true.
- Retranslating notification history (above).
- Any locale beyond en/fr/pcm.

## Phasing

Four commits, each independently verifiable:

1. `copy.ts` + locale resolution + `notifications` catalog (English), WhatsApp
   migrated — it is already central, so it is the cheapest proof the mechanism
   works end to end.
2. Push call sites.
3. In-app call sites.
4. fr/pcm strings + broadcast locale grouping.

## Testing

- Renders in the recipient's locale, **not** the actor's — the central case.
- Unknown/missing locale falls back to `en`.
- `broadcastPush` splits into one batch per locale.
- `notifyBoth` sends both channels with the same rendered copy.
- Existing tests asserting English copy strings are updated to the new shape.
- Locale key parity across en/fr/pcm (`message-parity.test.ts` already enforces).

## Caveat on the translations

The fr and pcm strings are machine-assisted drafts written by Claude, like every
other locale block in this project. Per the original design they need a human
pass before being called final. No human has yet reviewed any of them.
