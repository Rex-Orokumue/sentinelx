# SentinelX Notification Center — Design Spec

**Date:** 2026-08-16
**Status:** Approved → ready for implementation
**Phase:** 3

---

## 1. Three-Tier Notification System

| Tier | Channel | Cost | Coverage |
|------|---------|------|----------|
| 1 | **In-app notification center** | Free (DB rows) | Everything. Always on. Persistent history. |
| 2 | **FCM Web Push** | Free (Google) | Medium-priority events when player isn't on site. Works on Android Chrome without an app. |
| 3 | **WhatsApp via Termii** | ~₦11/message | 5–6 mission-critical events only. Dormant until `TERMII_API_KEY` is set. |

Every event writes to the in-app center. A subset also triggers FCM push. A small subset also triggers WhatsApp (dormant). Tiers are additive — never exclusive.

---

## 2. Notification Types

```ts
// lib/notifications/types.ts

export type NotificationType =
  // Tournament
  | 'tournament_announced'       // New tournament opens for registration
  | 'registration_confirmed'     // Your registration was confirmed
  | 'bracket_released'           // Bracket for your tournament is live
  | 'match_assigned'             // You've been assigned a match
  | 'match_reminder'             // Your match is in 1 hour
  | 'result_confirmed'           // Match result confirmed
  | 'prize_credited'             // Prize money approved for withdrawal
  // Community
  | 'new_announcement'           // Admin pinned a new announcement post
  | 'post_reaction'              // Someone reacted to your post
  | 'post_comment'               // Someone commented on your post
  // Economy
  | 'achievement_unlocked'       // Achievement earned
  | 'challenge_completed'        // Weekly challenge done
  | 'wager_settled'              // Coin wager result
  | 'referral_converted'         // A referred player entered their first tournament
  // Admin
  | 'admin_flag'                 // Admin flagged your account

// Which tiers each type uses
export const NOTIFICATION_CHANNELS: Record<NotificationType, {
  inApp:    boolean
  fcm:      boolean
  whatsapp: boolean  // dormant unless TERMII_API_KEY is set
}> = {
  tournament_announced:    { inApp: true,  fcm: true,  whatsapp: false },
  registration_confirmed:  { inApp: true,  fcm: true,  whatsapp: true  },
  bracket_released:        { inApp: true,  fcm: true,  whatsapp: true  },
  match_assigned:          { inApp: true,  fcm: true,  whatsapp: false },
  match_reminder:          { inApp: true,  fcm: true,  whatsapp: true  },
  result_confirmed:        { inApp: true,  fcm: true,  whatsapp: true  },
  prize_credited:          { inApp: true,  fcm: true,  whatsapp: true  },
  new_announcement:        { inApp: true,  fcm: true,  whatsapp: false },
  post_reaction:           { inApp: true,  fcm: false, whatsapp: false },
  post_comment:            { inApp: true,  fcm: true,  whatsapp: false },
  achievement_unlocked:    { inApp: true,  fcm: true,  whatsapp: false },  // WhatsApp pref-controlled, off by default
  challenge_completed:     { inApp: true,  fcm: true,  whatsapp: false },
  wager_settled:           { inApp: true,  fcm: true,  whatsapp: false },
  referral_converted:      { inApp: true,  fcm: true,  whatsapp: false },
  admin_flag:              { inApp: true,  fcm: true,  whatsapp: false },
}
```

`post_reaction` is in-app only — too high-frequency and low-stakes for push. If you get 20 reactions in an hour, push notifications would be maddening.

---

## 3. Database Schema

### `notifications` table

```sql
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type          text NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  data          jsonb,          -- type-specific payload (match_id, post_id, etc.)
  read_at       timestamptz,   -- null = unread
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_player_unread ON notifications(player_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Players read and update their own notifications only
CREATE POLICY "player reads own" ON notifications FOR SELECT
  USING (auth.uid() = player_id);
CREATE POLICY "player marks read" ON notifications FOR UPDATE
  USING (auth.uid() = player_id)
  WITH CHECK (auth.uid() = player_id);

-- Inserts via service role only (createAdminClient)
```

### `fcm_tokens` table

```sql
CREATE TABLE fcm_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token         text NOT NULL UNIQUE,
  last_active   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fcm_tokens_player ON fcm_tokens(player_id);

ALTER TABLE fcm_tokens ENABLE ROW LEVEL SECURITY;

-- Players manage their own tokens
CREATE POLICY "player manages own tokens" ON fcm_tokens FOR ALL
  USING (auth.uid() = player_id);
```

Tokens can expire — FCM returns `UNREGISTERED` or `INVALID_ARGUMENT` when a token is stale. The send function deletes stale tokens on that error response.

---

## 4. In-App Notification Center

### Bell icon in `SiteHeader`

The header already has a bell icon. Wire it up:

```
[🔔 3]   ← Badge shows unread count, max "99+"
```

- Unread count: `COUNT(*) FROM notifications WHERE player_id = auth.uid() AND read_at IS NULL`
- Fetched server-side in `getNavSession()` as `unreadNotifCount: number`
- Supabase Realtime subscription (`"use client"` on the bell component): `supabase.channel('notifications').on('postgres_changes', { event: 'INSERT', table: 'notifications', filter: `player_id=eq.${userId}` }, handler)` — increments the badge count in real-time without a page reload

### Notification drawer

Tapping the bell opens a right-side drawer (Radix UI `Sheet`, already in shadcn/ui). Not a full page — an overlay.

```
┌────────────────────────────────────────┐
│  NOTIFICATIONS              [Mark all read] │
│  ─────────────────────────────────────  │
│  ● [🏆] Tournament bracket is live!     │
│    DLS Community Club #4 · 2m ago       │
│    [View Bracket →]                     │
│  ─────────────────────────────────────  │
│  ● [⚽] Result confirmed — You won 3–1  │
│    vs Arole · Community Club #4 · 1h ago│
│    [View Match →]                       │
│  ─────────────────────────────────────  │
│    [🪙] You earned +250 coins!          │
│    Referral reward — Drizzy signed up   │
│    · 2h ago                             │
│  ─────────────────────────────────────  │
│  [Load more]                            │
└────────────────────────────────────────┘
```

- Unread: left blue dot + slightly brighter background
- Read: no dot, normal background
- Tapping a notification: marks it read + navigates to `data.url` (e.g. `/matches/[id]`, `/community`, `/dashboard/wallet`)
- "Mark all read": `UPDATE notifications SET read_at = now() WHERE player_id = ? AND read_at IS NULL` — Server Action
- Initial load: 20 most recent, "Load more" fetches next 20
- Empty state: "You're all caught up 🎮" — centered, no drama

### Notification item shape

Each `data` jsonb payload follows a type-specific shape. Claude Code should define these interfaces in `lib/notifications/types.ts`:

```ts
type NotificationData =
  | { url: string; match_id: string; tournament_name: string }          // result_confirmed
  | { url: string; tournament_id: string; tournament_name: string }     // bracket_released
  | { url: string; post_id: string; author_name: string }              // post_comment
  | { url: string; achievement_name: string; coins: number; xp: number } // achievement_unlocked
  | { url: string; coins: number }                                      // wager_settled
  // etc. — one per type
```

`url` is always present on every type — it's where the notification links to.

---

## 5. FCM Web Push

### Firebase Setup

1. Create Firebase project (free) at console.firebase.google.com
2. Enable Cloud Messaging
3. Add web app → get config object

**Environment variables:**
```
# Public — safe to expose via NEXT_PUBLIC_
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Secret — server only
FCM_SERVER_KEY=          # Firebase project settings → Cloud Messaging → Server key
```

### Service Worker

`public/firebase-messaging-sw.js` — must be at the root path (Firebase requirement):

```js
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey:            self.FIREBASE_API_KEY,
  authDomain:        self.FIREBASE_AUTH_DOMAIN,
  projectId:         self.FIREBASE_PROJECT_ID,
  messagingSenderId: self.FIREBASE_MESSAGING_SENDER_ID,
  appId:             self.FIREBASE_APP_ID,
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification.title, {
    body:  payload.notification.body,
    icon:  '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    data:  payload.data,
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(clients.openWindow(url))
})
```

The Firebase config values are injected at build time via `next.config.js` `publicRuntimeConfig` or via a small script tag in `app/layout.tsx` that writes them to `self` before the SW imports.

### Permission Request Flow

**Never ask on page load.** Wait for a meaningful interaction:

- After player completes their first tournament registration → prompt
- After player's first match result is confirmed → prompt
- In `/dashboard/settings` under Notifications: explicit "Enable push notifications" button

Permission prompt component (`components/notifications/PushPermissionPrompt.tsx`, `"use client"`):

```tsx
// Called by the parent after a meaningful event
async function requestPushPermission() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return

  const messaging = getMessaging(firebaseApp)
  const token = await getToken(messaging, { vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY })

  // Save token to DB
  await fetch('/api/notifications/fcm-token', {
    method: 'POST',
    body: JSON.stringify({ token }),
    headers: { 'Content-Type': 'application/json' },
  })
}
```

**API route** (`app/api/notifications/fcm-token/route.ts`):
- `POST`: upsert token to `fcm_tokens` for the authenticated player. If token exists (UNIQUE constraint), update `last_active`.
- `DELETE`: remove token (called on logout).

### Sending via FCM

`lib/notifications/fcm.ts`:

```ts
const FCM_ENDPOINT = 'https://fcm.googleapis.com/fcm/send'

export async function sendFCMToPlayer(
  playerId: string,
  notification: { title: string; body: string },
  data: Record<string, string>   // FCM data must be string values
): Promise<void> {
  if (!process.env.FCM_SERVER_KEY) {
    console.warn('[FCM] FCM_SERVER_KEY not set — push skipped')
    return
  }

  const adminClient = createAdminClient()
  const { data: tokens } = await adminClient
    .from('fcm_tokens')
    .select('id, token')
    .eq('player_id', playerId)

  if (!tokens?.length) return

  for (const { id, token } of tokens) {
    const res = await fetch(FCM_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `key=${process.env.FCM_SERVER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        notification,
        data,
        webpush: {
          fcm_options: { link: data.url },
        },
      }),
    })
    const json = await res.json()

    // Stale token — delete it
    if (json.results?.[0]?.error === 'NotRegistered' ||
        json.results?.[0]?.error === 'InvalidRegistration') {
      await adminClient.from('fcm_tokens').delete().eq('id', id)
    }
  }
}

// Broadcast to ALL players with tokens (for tournament_announced, new_announcement)
export async function broadcastFCM(
  notification: { title: string; body: string },
  data: Record<string, string>
): Promise<void> {
  // FCM topic messaging — subscribe all tokens to 'all-players' topic on registration
  // Or: batch fetch all tokens and send individually (simpler, fine for current scale)
  const adminClient = createAdminClient()
  const { data: tokens } = await adminClient
    .from('fcm_tokens')
    .select('token')

  // Batch in groups of 500 (FCM multicast limit)
  // Implementation detail for Claude Code
}
```

---

## 6. Unified `notifyPlayer()` — Updated

`lib/notifications/send.ts` is the single entry point for all notifications:

```ts
export async function notifyPlayer(
  playerId: string,
  type: NotificationType,
  payload: {
    title: string
    body: string
    data: NotificationData
    whatsappMessage?: string   // Only needed for WhatsApp-eligible types
  },
  options?: { matchId?: string }
): Promise<void> {
  const channels = NOTIFICATION_CHANNELS[type]
  const adminClient = createAdminClient()

  // Tier 1: Always write to in-app center
  if (channels.inApp) {
    await adminClient.from('notifications').insert({
      player_id: playerId,
      type,
      title:     payload.title,
      body:      payload.body,
      data:      payload.data,
    })
    // Supabase Realtime fires automatically on INSERT — client badge updates instantly
  }

  // Tier 2: FCM push (fire and forget)
  if (channels.fcm) {
    sendFCMToPlayer(playerId, { title: payload.title, body: payload.body }, {
      url:  payload.data.url,
      type,
    }).catch(err => console.error('[FCM] push failed:', err))
  }

  // Tier 3: WhatsApp — only if key is set AND player opted in AND type is WhatsApp-eligible
  if (channels.whatsapp && payload.whatsappMessage) {
    notifyPlayerWhatsApp(playerId, type, payload.whatsappMessage, options)
      .catch(err => console.error('[Termii] notify failed:', err))
  }
}

// Broadcast variant — for announcements to all players
export async function broadcastNotification(
  type: Extract<NotificationType, 'tournament_announced' | 'new_announcement'>,
  payload: { title: string; body: string; data: NotificationData }
): Promise<void> {
  // 1. Bulk insert into notifications for all players (admin client, batched)
  // 2. FCM broadcast
  // Does NOT send WhatsApp — too expensive at broadcast scale
}
```

---

## 7. Integration Points

All these already exist in the codebase. Add `notifyPlayer(...)` calls — all non-blocking (`.catch()` or `void`):

| Event | File | Who gets notified |
|-------|------|------------------|
| Tournament registration confirmed | `lib/tournaments/actions.ts` | Registering player |
| Bracket released (admin publishes bracket) | `lib/admin/tournaments.ts` | All registered players |
| Match assigned | `lib/matches/actions.ts` (when match row created) | Both players |
| Match reminder (cron) | `app/api/cron/match-reminders/route.ts` | Both players |
| Result confirmed | `lib/matches/actions.ts::confirmResult` | Both players (different messages) |
| Prize withdrawal approved | `lib/wallet/actions.ts` | Player |
| New pinned announcement | `lib/community/actions.ts::createPost` (when is_pinned=true) | Broadcast all |
| New tournament announced | `lib/admin/tournaments.ts::publishTournament` | Broadcast all |
| Post commented | `lib/community/actions.ts::createComment` | Post author |
| Post reacted | `lib/community/actions.ts::toggleReaction` | Post author (in-app only) |
| Achievement unlocked | `lib/achievements/actions.ts::awardAchievement` | Player |
| Challenge completed | `lib/community/challenges.ts::recordProgress` | Player |
| Wager settled | `lib/matches/actions.ts` (wager settlement block) | All bettors |
| Referral converted | `lib/tournaments/actions.ts` (first registration check) | Referrer |
| Admin flag | `lib/admin/players.ts::flagPlayer` | Flagged player |

---

## 8. Notification Preferences — Updated

The `notification_prefs` JSONB on `profiles` (specced in player-profile-settings-design.md) expands to include FCM controls:

```json
{
  "whatsapp": { ... },
  "push": {
    "match_reminder":         true,
    "result_confirmed":       true,
    "achievement_unlocked":   true,
    "challenge_completed":    true,
    "new_announcement":       true,
    "tournament_announced":   true,
    "wager_settled":          true,
    "referral_converted":     true,
    "post_comment":           true,
    "post_reaction":          false,
    "bracket_released":       true,
    "match_assigned":         true,
    "prize_credited":         true
  },
  "achievement_sharing": { ... }
}
```

`notifyPlayer()` checks `notification_prefs.push[type]` before sending FCM (same pattern as WhatsApp pref check). The `push_all` master toggle in `/dashboard/settings` sets all push keys to false at once (enables/disables all push without deleting the token).

---

## 9. Settings Page — Push Notifications Section

Add to `/dashboard/settings` below the WhatsApp section:

```
PUSH NOTIFICATIONS
Receive browser notifications even when you're not on the site.
──────────────────────────────────────────────────────────────
Status: Not enabled     [Enable Push Notifications]
        ↓ after permission granted:
Status: ✅ Enabled       [Disable]

Individual toggles (same pattern as WhatsApp prefs, collapsed behind "Customize →")
```

The `Enable Push Notifications` button calls `requestPushPermission()` from the FCM client.

---

## 10. Out of Scope

- iOS Safari push (Safari 16.4+ supports Web Push, but testing and PWA manifest configuration is a separate effort — defer to Phase 4)
- Native mobile app push (APNs / Android FCM native app) — Phase 4+ (would require a React Native or Expo build)
- Email notifications — not planned; Supabase Auth covers the essential transactional emails already
- Notification categories / grouping in the drawer — Phase 4
- "Snooze notifications" — Phase 4
