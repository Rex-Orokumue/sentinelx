# Masters invitation payment recovery

**Date:** 2026-10-25
**Approved:** Full wallet payment alongside Paystack, persistent unpaid entry controls, and per-player admin resend/revive.

## Problem

Acceptance changes an invitation from `pending` to `accepted` before payment. The dashboard only reads pending invitations, and the public registration form blocks invitation-only tournaments. An accepted player who leaves checkout has no payment path. The admin panel can revive expired rows in bulk but cannot resend a valid invitation notification to one player.

## Player flow

- A valid pending invitation offers **Pay from wallet** when the wallet holds the full fee and **Pay with Paystack**. A free entry confirms without payment.
- Acceptance creates one registration and keeps the accepted invitation linked to it. Accepted, unpaid entries remain on the dashboard and tournament page with both payment choices until paid. The invitation response deadline does not revoke an already accepted spot; registration must still be open.
- Wallet payment debits the exact tournament fee and marks the registration paid in one service-role database transaction. Insufficient funds change neither balance nor registration. Repeated requests cannot debit twice.
- A Paystack retry creates a tracked new reference. Every reference remains linked to the registration so an earlier successful checkout is still recognized. Paystack verification remains server-side.
- If Paystack succeeds after the registration was paid from wallet, credit that verified extra amount to the player's wallet exactly once. A wallet attempt after Paystack has already settled returns already paid.

## Admin flow

- Staff can resend a valid pending invitation without changing its deadline or slot. A fresh notification key avoids suppression by the original send.
- Staff can revive one expired invitation only if a slot is open. An overdue pending invitation is expired first, then the same capacity rule applies. Declined and accepted invitations cannot be re-invited through this control. An accepted unpaid player instead uses the persistent payment path.
- The invitation table shows payment state for accepted players so staff can distinguish an accepted unpaid spot from a paid entry.

## Data and security

- A new service-role-only RPC serializes wallet settlement on the registration row, then performs the wallet debit, ledger write, and registration update in one transaction. It validates player, accepted invitation, tournament fee, and registration state from database rows, never client input.
- A payment-attempt table retains invitation Paystack references. A separate service-role-only RPC serializes verified Paystack settlement with wallet settlement and credits any late extra charge once.
- No anon/authenticated write grants are added to sensitive tables or payment functions. The server checks the signed-in caller before using the admin client. Admin actions require staff authorization.
- Mobile endpoints use `defineEndpoint()` with idempotent money-changing POSTs, and the OpenAPI document is regenerated last.

## Verification

Cover acceptance, wallet insufficiency and retries, Paystack retry and late callback, dashboard/tournament payment visibility, and targeted admin resend/revive. Run focused tests, the full Vitest suite, lint, and build in the isolated worktree. No production migration or data change is part of this work.
