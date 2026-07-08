# Admin Withdrawal Queue — Design (#9 sub-project 6 of 6 — completes v1.0)

**Route:** `/admin/withdrawals` (new)
**Date:** 2026-07-08
**Status:** Approved, ready for implementation plan

## Context

The final Admin Dashboard sub-project; it closes out #9 and all of v1.0. The `withdrawal_requests`
table, its RLS (`wr_admin_update`, `wr_own_or_admin_read`), the one-pending-per-player index, and
the player-facing request form (`WithdrawalPanel`) all shipped in #8. This is purely the **admin
resolution side**: mark a pending request **paid** or **rejected**. The actual bank transfer is
manual and outside the app (Paystack Transfer is v3.0); "mark paid" records that the admin sent the
money. **No migration.**

## Role

`requireAdmin` — withdrawal resolution is a financial action; moderators are excluded (the shell's
two-tier gate). This is the first real consumer of `requireAdmin` since the shell defined it.

## Nav + overview

- Append `{ label: 'Withdrawals', href: '/admin/withdrawals', adminOnly: true }` to `ADMIN_NAV`;
  `visibleNav` already hides `adminOnly` items from moderators (hide-and-guard).
- Link the Overview **Pending withdrawals** `StatCard` (already admin-only) → `/admin/withdrawals`.

## Shared naira formatter — `lib/format.ts`

Extract `formatNaira(n: number): string` (`₦` + `n.toLocaleString('en-NG')`) into a shared module
and route every naira-display site through it, completing the DRY cleanup in one pass:
- `components/dashboard/WithdrawalPanel.tsx` (drop its local `formatNaira`),
- `components/tournament/TournamentCard.tsx` (prize pool, entry fee),
- `components/tournament/RegistrationPanel.tsx` (fee, three sites),
- `app/(public)/tournaments/[slug]/page.tsx` (prize pool + entry fee `Stat`s, share text, metadata),
- and the new admin withdrawal UI.

(Hall of Fame formats goals, not naira, so it is untouched.) Grouping output is unchanged — the
existing inline calls use `toLocaleString()` with no locale, which yields the same digit grouping as
`'en-NG'`.

## Page — `app/admin/withdrawals/page.tsx` (`requireAdmin`)

Two sections:
- **Pending** (actionable) — each request shows player name, **amount** (`formatNaira`), and the
  **bank name / account number / account name** (so the admin can make the transfer), plus
  `requested_at`. Each renders a `WithdrawalQueueRow` with the resolve controls. **Empty state** when
  there are none: "No pending withdrawals" (consistent with every other admin page).
- **Recently resolved** (read-only audit) — the **last 20 by `resolved_at` descending**, showing
  player, amount, status (`paid`/`rejected`), `resolved_at`, and `admin_note`. A financial surface
  needs a history; this is where the admin looks if a payment is questioned.

## Action — `lib/withdrawals/admin-actions.ts` (`requireAdmin`)

`resolveWithdrawal(prev, formData)` — reads `id`, `action` (`'paid' | 'rejected'`, from the clicked
button), `note`. Rules:
- `action` must be `paid` or `rejected`.
- **`rejected` requires a non-empty `note`** (the player is owed a reason — same principle as the
  dispute note); **`paid`'s note is optional** (e.g. a transfer reference).
- Re-fetch the request and **refuse unless `status = 'pending'`** (terminal once resolved — no
  re-resolve).
- Update `status`, `admin_note` (the note, or `null` when paid with no note), `resolved_at = now`.
- Uses the user's session client (RLS `wr_admin_update` already permits admins).
- `revalidatePath('/admin/withdrawals')` **and `/dashboard`** so the player sees the new status +
  note in their `WithdrawalPanel`.

## Component — `components/admin/WithdrawalQueueRow.tsx` (`"use client"`)

One pending request's resolve controls (`useFormState` over `resolveWithdrawal`): a note textarea
and two submit buttons — **Mark paid** (`name="action" value="paid"`) and **Reject**
(`name="action" value="rejected"`) — plus the request details. Shows the action's error (e.g.
"Enter a reason for the rejection.").

## Security

- `requireAdmin` on the page and the action; the action re-checks `status='pending'` server-side.
- RLS independently restricts the read (own-or-admin) and update (admin) of `withdrawal_requests`.
- Bank details are the player's own data shown to an admin for the transfer — not exposed publicly.

## Testing

- Vitest on `lib/format.ts`: `formatNaira` groups thousands and prepends `₦` (e.g. `1000 → ₦1,000`).
- The resolution guard (`rejected` needs a note; only `pending` is resolvable) is thin and lives in
  the action — exercised via the build and manual admin testing on the seeded data.

## Consistency notes

- Mobile-first; queue rows stack at 375px.
- Marks roadmap **#9 done** and, with it, **all of v1.0** — this is the last sub-project. Update
  `ROADMAP.md` #9 → ✅.
- No WhatsApp share (admin is private).
