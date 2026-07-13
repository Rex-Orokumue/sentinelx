# Player Notification System — Design Spec

**Date:** 2026-07-13
**Status:** Approved design → ready for implementation plan
**Depends on:** none — this is foundational infrastructure other specs consume.
**Unblocks:** #26 (friend request notifications), #27 (admin notifications — likely becomes "this same system, filtered to staff" rather than a separate build).

---

## 1. Goal

An in-app notification bell, general-purpose from day one: friend requests, exchange listing moderation, prize/referral withdrawal outcomes, match result confirmations, and referral credits all land in one inbox. Eight of those nine notification types (every one except friend requests — see §3's full list) already exist in shipped code and get retrofitted with a notification call in this spec; `friend_request` doesn't exist yet and will call into this system when #26 builds it.

## 2. Naming — do not confuse with the existing `notifications` table

`public.notifications` already exists (migration `011_notifications.sql`) — it's the outbound **WhatsApp send-log** (Termii), service-role-only, no player-facing UI. This spec's table is a **different concept**: an in-app inbox a player reads in the browser. To avoid any confusion between the two, the new table is `player_notifications`, and the new helper function is `notifyInApp()` (parallel to, not a replacement for, the existing `notify()` WhatsApp helper). Both can fire for the same event (e.g. a confirmed result could notify by WhatsApp *and* show up in the bell) — they are independent, unrelated systems that happen to serve a similar purpose over different channels.

## 3. Schema

**Migration `022_player_notifications.sql`:**

```sql
CREATE TABLE public.player_notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid        NOT NULL REFERENCES public.profiles(id),
  type       text        NOT NULL
               CHECK (type IN (
                 'listing_approved', 'listing_removed',
                 'withdrawal_paid', 'withdrawal_rejected',
                 'referral_withdrawal_paid', 'referral_withdrawal_rejected',
                 'result_confirmed', 'referral_credited',
                 'friend_request'
               )),
  title      text        NOT NULL,
  body       text        NOT NULL,
  link       text,
  read       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.player_notifications (player_id, created_at DESC);

ALTER TABLE public.player_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_notifications_self_read" ON public.player_notifications
  FOR SELECT USING (player_id = auth.uid());
-- Self-update exists only so a player can mark their own notification read;
-- the client action only ever touches the `read` column.
CREATE POLICY "player_notifications_self_update" ON public.player_notifications
  FOR UPDATE USING (player_id = auth.uid());
-- No INSERT policy at all — writes only via notifyInApp()'s service-role client.
```

The `type` CHECK enumerates every valid category so a typo can't silently create a phantom notification type. `friend_request` is included now even though nothing writes it yet (#26 will), so the constraint doesn't need editing twice. **Growing this list is expected** — every future feature that wants a notification adds its type here first.

## 4. `notifyInApp()` helper

`lib/notifications/inbox.ts` — same file *area* as the existing WhatsApp `notify()` (`lib/notifications/notify.ts`) since they're conceptually siblings, but a separate file/table/function, not a shared code path:

```typescript
import { createAdminClient } from '@/lib/supabase/admin'

export type NotificationType =
  | 'listing_approved' | 'listing_removed'
  | 'withdrawal_paid' | 'withdrawal_rejected'
  | 'referral_withdrawal_paid' | 'referral_withdrawal_rejected'
  | 'result_confirmed' | 'referral_credited'
  | 'friend_request'

// Best-effort — NEVER throws into the caller's primary action, mirroring
// lib/notifications/notify.ts's WhatsApp helper. A failed in-app notification
// insert must never break the withdrawal/result/listing action it's attached to.
export async function notifyInApp(input: {
  playerId: string
  type: NotificationType
  title: string
  body: string
  link?: string
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('player_notifications').insert({
      player_id: input.playerId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
    })
  } catch {
    // best-effort — swallow so the caller's action is never affected
  }
}
```

Uses `createAdminClient()` internally regardless of what client the calling Server Action normally uses (some use the session client, some already use the admin client) — callers never pass a client in, matching `notify()`'s existing shape exactly.

## 5. Bell UI — explicit placement

**The bell lives in the top header (`components/shared/SiteHeader.tsx`) at every breakpoint. It is never added to `BottomTabBar` and is never a sixth mobile tab.**

- On **desktop**, it renders next to `AccountMenu` (both visible together in the header's right-hand group).
- On **mobile**, `AccountMenu` itself is already desktop-only (`hidden sm:block`) — mobile's account access lives entirely in `BottomTabBar`, unrelated to this feature. The bell still renders in the top header on mobile, unconditionally, as the one and only header element visible there when logged in — it does not depend on or sit "next to" anything mobile-specific, since there is nothing else in the mobile header today.
- Rendered only when `session.isLoggedIn` — logged-out visitors see nothing new.

Unread count is computed server-side (a `count`-only query against `player_notifications` where `read = false`) on each page render carrying the header — no realtime subscription; the badge is accurate as of the last navigation, matching how every other count in this codebase (admin queue badges, etc.) already works, since Supabase Realtime is used nowhere in this project today.

Clicking the bell opens a dropdown panel — same interaction pattern already established this session for `AccountMenu`/`ImageLightbox` (click-outside + Escape to close). The panel lists the most recent 20 notifications, newest first; unread ones are visually distinct (e.g. a dot or bold title) from read ones, which stay visible but de-emphasized. Clicking an individual notification (not the bell itself) marks that row read and navigates to its `link`.

## 6. Retrofitting the 5 existing event types

One `notifyInApp()` call added alongside each event's current logic — no other behavior in these functions changes:

| Event | File | Type |
|---|---|---|
| Listing approved | `lib/exchange/admin-actions.ts` (`approveListing`) | `listing_approved` |
| Listing removed by admin | `lib/exchange/admin-actions.ts` (`removeListingAdmin`) | `listing_removed` |
| Prize withdrawal paid | `lib/withdrawals/admin-actions.ts` (`resolveWithdrawal`, `action === 'paid'`) | `withdrawal_paid` |
| Prize withdrawal rejected | `lib/withdrawals/admin-actions.ts` (`resolveWithdrawal`, `action === 'rejected'`) | `withdrawal_rejected` |
| Referral withdrawal paid | `lib/referrals/admin-actions.ts` (`resolveReferralWithdrawal`, `action === 'paid'`) | `referral_withdrawal_paid` |
| Referral withdrawal rejected | `lib/referrals/admin-actions.ts` (`resolveReferralWithdrawal`, `action === 'rejected'`) | `referral_withdrawal_rejected` |
| Match result confirmed | `lib/matches/verify-actions.ts` (`confirmResult`) | `result_confirmed` (fires for both players, same as the existing WhatsApp `notify()` call already there) |
| Referral credited | `app/auth/confirm/route.ts` (`creditReferralIfAny`) | `referral_credited` (notifies the **referrer**, not the newly-signed-up player) |

`friend_request` is not wired anywhere in this spec — #26 adds that call when it builds the friend-request flow, using the `notifyInApp()` helper and `friend_request` type this spec establishes.

## 7. Out of scope

- Realtime/live badge updates — server-computed on page load only, per §5.
- Mark-all-as-read — only individual-notification click-to-read, per the approved design.
- Notification preferences/opt-out — every event type always notifies; no per-player settings.
- #27 (admin notifications) is not built by this spec — it's flagged as likely becoming a thin staff-filtered view of this same system in its own follow-up spec, not designed here.
