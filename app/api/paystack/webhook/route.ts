import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/paystack/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { confirmFriendlyStake } from '@/lib/friendly-matches/confirm'
import { applyIdentificationWebhook, extractIdentificationCustomerCode } from '@/lib/kyc/webhook'

export const runtime = 'nodejs'

// Machine-to-machine. Fires independently of the user's browser — the reliable
// source of truth for payment, identification, and transfer status.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature')

  if (!verifyWebhookSignature(rawBody, signature)) {
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let event: {
    event?: string
    data?: {
      reference?: string
      reason?: string
      message?: string
      customer?: { customer_code?: string }
    }
  }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return new NextResponse('Bad payload', { status: 400 })
  }

  const type = event.event

  if (type === 'charge.success' && event.data?.reference) {
    const result = await confirmRegistration(event.data.reference)
    // Fan-out is gated strictly on this exact return value — never on
    // catching an exception. confirmRegistration doesn't throw in practice
    // (every path resolves to a ConfirmResult string); if that ever changes,
    // a genuine error must still propagate as a 500, not fall through here.
    if (result === 'not_found') {
      await confirmFriendlyStake(event.data.reference)
    }
  } else if (type === 'customeridentification.success' || type === 'customeridentification.failed') {
    // data IS the customer object for this event family (customer_code at the
    // top level) — not a transaction with a nested customer like charge.success.
    const customerCode = extractIdentificationCustomerCode(event.data)
    if (customerCode) {
      await applyIdentificationWebhook(customerCode, type, event.data?.message ?? null)
    }
  }
  // transfer.success/failed/reversed: no longer handled — withdrawal payouts
  // are manual-only (see docs/superpowers/specs/2026-07-13-player-wallet-system-design.md
  // §out-of-scope). Re-add this branch alongside re-enabling automated
  // Paystack Transfer, not before.

  // Always 200 on a well-formed, signed request; Paystack retries non-2xx.
  return new NextResponse('ok', { status: 200 })
}
