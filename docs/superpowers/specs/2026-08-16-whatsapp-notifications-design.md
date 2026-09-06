# SentinelX WhatsApp Notifications — Design Spec

**Date:** 2026-08-16
**Status:** Approved → ready for implementation
**Phase:** 3 (v2.0 per CLAUDE.md roadmap)

---

## 1. Provider Decision

**Termii** — Nigerian messaging gateway with WhatsApp Business API support.

- CAC registration is pending for Meta WhatsApp Cloud API direct access; Termii handles the WhatsApp BSP (Business Solution Provider) relationship in the interim
- Already referenced in CLAUDE.md as the Phase 2 notification provider
- Nigerian-native: NGN billing, local support, already used by Nigerian fintechs
- API is simple: one endpoint, JSON body, `api_key` auth

**Environment variable required:**
```
TERMII_API_KEY=your_key_here
```

Never committed to git. Added to Vercel project env vars and to `.env.local.example` as a placeholder only.

**Sender ID:** `SentinelX` (pre-register this as a Termii sender ID — WhatsApp requires an approved Business display name)

---

## 2. Player Opt-In Model

**Opt-in is tied to providing a WhatsApp number.** A player who adds their number to `/dashboard/settings` and saves it has opted in to notifications. No separate opt-in checkbox needed — the act of entering a phone number is explicit consent.

Player preferences per notification type are controlled in `profiles.notification_prefs` (specced in `2026-08-16-player-profile-settings-design.md §4.2`):

```json
{
  "whatsapp": {
    "match_reminder": true,
    "result_confirmed": true,
    "prize_credited": true,
    "challenge_completed": false,
    "achievement_unlocked": false,
    "registration_confirmed": true
  }
}
```

**No number → no notification, silently.** If `profiles.whatsapp_number IS NULL` or blank: skip the notification. No error, no logging — it's expected.

**Wrong number → Termii delivery failure → log + move on.** Delivery failures are logged to `notification_logs` (see §4) with `status = 'failed'` and `termii_response` captured. The main Server Action that triggered the notification is never affected — notifications are always non-blocking.

**Opt-out in settings:** player removes their number or toggles individual notification types off. Takes effect immediately.

---

## 3. Notification Types

### 3.1 Registration Confirmed

**Trigger:** Tournament registration Server Action completes (either Paystack webhook confirmed or free-entry coin path completed).
**Pref key:** `registration_confirmed`
**Recipient:** Registering player

**Message template:**
```
🎮 *SentinelX* — You're in!

You've registered for *{{tournament_name}}*.

💰 Entry: {{fee_display}}
📅 Starts: {{start_date}}
🔗 View: {{tournament_url}}

Good luck, {{first_name}}! 🔥
```

`fee_display` examples: "₦500", "₦250 (500 coins used)", "Free (1,000 coins)"
`first_name` = first word of `display_name`

---

### 3.2 Fixture Reminder (1 Hour Before Kickoff)

**Trigger:** Scheduled cron job — runs every hour. Sends reminders for all matches where `scheduled_at` is between `now() + 55 minutes` and `now() + 65 minutes` (10-min window to avoid duplicates across hourly runs).
**Pref key:** `match_reminder`
**Recipients:** Both players in the match (Player A and Player B)

**Message template:**
```
⏰ *SentinelX* — Match in 1 hour!

*{{tournament_name}}*
You vs *{{opponent_name}}*
🕐 {{match_time}} WAT

📺 Match Centre: {{match_url}}

Don't be late — a no-show costs you 100 SX Score. 💪
```

**Cron schedule:** `0 * * * *` (top of every hour, Vercel Cron)
**Cron route:** `app/api/cron/match-reminders/route.ts`
**Auth:** `Authorization: Bearer ${process.env.CRON_SECRET}` header check (never in git — same pattern as other cron routes)

**Deduplication:** Before sending, insert into `notification_logs` (`type = 'match_reminder'`, `match_id`, `player_id`). If row already exists for this combination: skip. `UNIQUE(type, match_id, player_id)` constraint on `notification_logs` prevents double-send even if cron fires twice.

---

### 3.3 Result Confirmed

**Trigger:** Admin confirms match result in Admin Dashboard (existing `confirmResult` Server Action).
**Pref key:** `result_confirmed`
**Recipients:** Both players

**Message template — Winner:**
```
🏆 *SentinelX* — Result confirmed!

{{tournament_name}} · {{opponent_name}}

Result: *You won {{score_a}}–{{score_b}}* 🎉

+100 SX Coins credited
+90 SX Score points

View result: {{match_url}}
```

**Message template — Loser:**
```
📊 *SentinelX* — Result confirmed.

{{tournament_name}} · {{opponent_name}}

Result: You lost {{score_a}}–{{score_b}}

Keep grinding — every match builds your ranking.

View result: {{match_url}}
```

`score_a` / `score_b` are from the perspective of the message recipient (winner's score first). If the score is unknown (result confirmed without a scoreline), omit the score line.

---

### 3.4 Prize Credited

**Trigger:** Admin approves withdrawal and marks prize as credited (or automated Paystack transfer completes — either path). The triggering Server Action already writes to `wallet_transactions`; add notification hook there.
**Pref key:** `prize_credited`
**Recipient:** Player whose wallet was credited

**Message template:**
```
💰 *SentinelX* — Prize money incoming!

*₦{{amount}}* has been approved for withdrawal.

Processing time: 1–2 business days.
Bank: {{bank_name}} · {{account_number_last4}}

View wallet: {{wallet_url}}

Keep competing to earn more! 🎮
```

`account_number_last4` = last 4 digits of the linked account number.

---

### 3.5 Weekly Challenge Completed

**Trigger:** When a `player_challenge_progress` row reaches `completed = true` (Server Action that records challenge progress).
**Pref key:** `challenge_completed` (OFF by default)
**Recipient:** Player who completed the challenge

**Message template:**
```
🪙 *SentinelX* — Challenge complete!

*{{challenge_name}}*

You earned:
+{{coins}} SX Coins
+{{xp}} XP

🔗 View challenges: sentinelxesports.com/community
```

---

### 3.6 Achievement Unlocked

**Trigger:** When a `player_achievements` row is inserted (in the Server Action that checks and awards achievements).
**Pref key:** `achievement_unlocked` (OFF by default)
**Recipient:** Player who unlocked the achievement

**Also gated by** `notification_prefs.achievement_sharing.[category]` — if the player has sharing OFF for that category, still send the WhatsApp notification (it's a private notification to them, not a public post). The sharing pref only controls feed auto-posts.

**Message template:**
```
🏅 *SentinelX* — Achievement unlocked!

*{{achievement_name}}*
"{{achievement_description}}"

You earned:
+{{coins}} SX Coins
+{{xp}} XP

View your profile: {{profile_url}}
```

---

## 4. Implementation — Termii Client

### `lib/notifications/termii.ts`

```ts
const TERMII_BASE = 'https://api.ng.termii.com/api'

interface TermiiSendPayload {
  to: string           // E.164 format: +2348000000000
  from: string         // 'SentinelX'
  sms: string          // Message text (WhatsApp supports markdown: *bold*, _italic_)
  type: 'plain'
  channel: 'whatsapp'
  api_key: string
}

interface TermiiResponse {
  message_id: string
  message: string
  balance: number
  user: string
}

export async function sendWhatsApp(
  to: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!process.env.TERMII_API_KEY) {
    console.warn('[Termii] TERMII_API_KEY not set — notification skipped')
    return { success: false, error: 'no_api_key' }
  }

  const payload: TermiiSendPayload = {
    to: normalizePhone(to),
    from: 'SentinelX',
    sms: message,
    type: 'plain',
    channel: 'whatsapp',
    api_key: process.env.TERMII_API_KEY,
  }

  try {
    const res = await fetch(`${TERMII_BASE}/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data: TermiiResponse = await res.json()
    if (!res.ok) throw new Error(JSON.stringify(data))
    return { success: true, messageId: data.message_id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function normalizePhone(raw: string): string {
  // Strip spaces, dashes, parentheses
  const digits = raw.replace(/\D/g, '')
  // Nigerian: 080... → +23480...
  if (digits.startsWith('0') && digits.length === 11) {
    return '+234' + digits.slice(1)
  }
  // Already has country code without +
  if (digits.startsWith('234')) {
    return '+' + digits
  }
  // Already E.164
  if (raw.startsWith('+')) return raw
  // Return as-is and let Termii reject it
  return '+' + digits
}
```

---

### `lib/notifications/templates.ts`

Each notification type gets a pure function that takes typed data and returns a string:

```ts
export function registrationConfirmedMsg(data: {
  displayName: string
  tournamentName: string
  feeDisplay: string
  startDate: string
  tournamentUrl: string
}): string { ... }

export function fixtureReminderMsg(data: { ... }): string { ... }
export function resultConfirmedWinnerMsg(data: { ... }): string { ... }
export function resultConfirmedLoserMsg(data: { ... }): string { ... }
export function prizeCreditedMsg(data: { ... }): string { ... }
export function challengeCompletedMsg(data: { ... }): string { ... }
export function achievementUnlockedMsg(data: { ... }): string { ... }
```

Pure functions: no DB access, no side effects, easy to unit test.

---

### `lib/notifications/send.ts`

The orchestration layer — checks prefs, reads phone number, calls `sendWhatsApp`, logs result:

```ts
export async function notifyPlayer(
  playerId: string,
  type: NotificationType,
  message: string
): Promise<void> {
  const adminClient = createAdminClient()

  // Fetch player phone + prefs
  const { data: profile } = await adminClient
    .from('profiles')
    .select('whatsapp_number, notification_prefs, display_name')
    .eq('id', playerId)
    .single()

  if (!profile?.whatsapp_number) return  // No number — skip silently

  const prefKey = PREF_KEY_MAP[type]  // e.g. 'match_reminder'
  const prefs = profile.notification_prefs?.whatsapp ?? DEFAULT_PREFS
  if (!prefs[prefKey]) return  // Player turned this type off

  const result = await sendWhatsApp(profile.whatsapp_number, message)

  // Log to notification_logs (non-blocking — fire and forget)
  adminClient.from('notification_logs').insert({
    player_id:       playerId,
    type,
    status:          result.success ? 'sent' : 'failed',
    termii_message_id: result.messageId,
    error_detail:    result.error,
  }).then()  // .then() intentionally — don't await
}
```

---

## 5. Notification Logs Table

```sql
CREATE TABLE notification_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           uuid REFERENCES profiles(id) ON DELETE CASCADE,
  type                text NOT NULL,
  status              text NOT NULL CHECK (status IN ('sent','failed','skipped')),
  termii_message_id   text,
  error_detail        text,
  match_id            uuid REFERENCES matches(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(type, match_id, player_id)  -- deduplication for match-specific notifications
);

ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;
-- No player read access — admin only via service role
```

`UNIQUE(type, match_id, player_id)` — the match_id column is nullable, so this only enforces uniqueness when match_id IS NOT NULL. For non-match notifications (prize_credited, achievement_unlocked), there's no deduplication constraint — those are intentionally per-event.

---

## 6. Integration Points

Where `notifyPlayer(...)` is called — all non-blocking (never awaited in the critical path):

| Trigger | File | Function called |
|---|---|---|
| Registration paid | `lib/tournaments/actions.ts::confirmRegistration` | `notifyPlayer(playerId, 'registration_confirmed', ...)` |
| Match result confirmed | `lib/matches/actions.ts::confirmResult` | `notifyPlayer(winnerId, ...)` + `notifyPlayer(loserId, ...)` |
| Prize withdrawal approved | `lib/wallet/actions.ts::approvePrizeWithdrawal` | `notifyPlayer(playerId, 'prize_credited', ...)` |
| Weekly challenge completed | `lib/community/challenges.ts::recordProgress` | `notifyPlayer(playerId, 'challenge_completed', ...)` |
| Achievement unlocked | `lib/achievements/actions.ts::awardAchievement` | `notifyPlayer(playerId, 'achievement_unlocked', ...)` |
| Cron: fixture reminder | `app/api/cron/match-reminders/route.ts` | `notifyPlayer(playerAId, ...)` + `notifyPlayer(playerBId, ...)` |

---

## 7. Fixture Reminder Cron — Full Logic

```ts
// app/api/cron/match-reminders/route.ts

export async function GET(req: Request) {
  // Auth check — must match CRON_SECRET
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const adminClient = createAdminClient()
  const now = new Date()
  const windowStart = new Date(now.getTime() + 55 * 60 * 1000)   // +55 min
  const windowEnd   = new Date(now.getTime() + 65 * 60 * 1000)   // +65 min

  // Fetch matches in the reminder window
  const { data: matches } = await adminClient
    .from('matches')
    .select(`
      id, scheduled_at, tournament_id,
      player_a:profiles!player_a_id(id, display_name, whatsapp_number, notification_prefs),
      player_b:profiles!player_b_id(id, display_name, whatsapp_number, notification_prefs),
      tournament:tournaments!tournament_id(name)
    `)
    .gte('scheduled_at', windowStart.toISOString())
    .lte('scheduled_at', windowEnd.toISOString())
    .eq('status', 'scheduled')

  if (!matches?.length) return new Response('OK — no matches', { status: 200 })

  for (const match of matches) {
    for (const [player, opponent] of [
      [match.player_a, match.player_b],
      [match.player_b, match.player_a],
    ]) {
      // Check dedup
      const { data: existing } = await adminClient
        .from('notification_logs')
        .select('id')
        .eq('type', 'match_reminder')
        .eq('match_id', match.id)
        .eq('player_id', player.id)
        .maybeSingle()

      if (existing) continue  // Already sent

      const message = fixtureReminderMsg({
        tournamentName: match.tournament.name,
        opponentName:   opponent.display_name,
        matchTime:      formatWAT(match.scheduled_at),
        matchUrl:       `${process.env.NEXT_PUBLIC_SITE_URL}/matches/${match.id}`,
      })

      await notifyPlayer(player.id, 'match_reminder', message, { matchId: match.id })
    }
  }

  return new Response('OK', { status: 200 })
}
```

`formatWAT(iso: string)` — formats to "3:00 PM" in West Africa Time (`Africa/Lagos` timezone).

---

## 8. Vercel Cron Configuration

In `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/match-reminders",
      "schedule": "0 * * * *"
    }
  ]
}
```

Runs at the top of every hour. Note: Vercel Cron on the free/hobby tier runs with a 1-minute tolerance — acceptable for match reminders.

---

## 9. Testing

- Unit tests for all template functions (`lib/notifications/templates.ts`) — verify correct substitutions, no undefined values
- Unit test for `normalizePhone` — Nigerian format variants (080, +234, 234)
- Integration test for `notifyPlayer` with a mock `sendWhatsApp`: verify pref-check skips, no-number skips, deduplication
- Cron route test: mock `adminClient` + `notifyPlayer`, verify window query and dedup logic
- **Never send real WhatsApp messages in tests** — mock `sendWhatsApp` at the module level in tests

---

## 10. Out of Scope

- OTP-based WhatsApp number verification — Phase 4 (currently we trust the number as-entered; if Termii can't deliver, it logs and moves on)
- Inbound WhatsApp messages (two-way chat) — never (requires a different Termii product tier and is out of scope for this platform)
- Push notifications (Firebase/APNs) — Phase 4+ (mobile app scope)
- SMS fallback if WhatsApp fails — Phase 4
- Email notifications — already handled by Supabase Auth built-in emails (reset, confirmation); no additional email notifications planned
- In-app notification bell — Phase 4 (there is already a notification bell icon in the header from the existing build; populating it with real data is a separate feature)
