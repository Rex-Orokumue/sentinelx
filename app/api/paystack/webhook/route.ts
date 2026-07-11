import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/paystack/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'
import { applyIdentificationWebhook } from '@/lib/kyc/webhook'
import { applyTransferWebhook } from '@/lib/withdrawals/webhook'

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
    await confirmRegistration(event.data.reference)
  } else if (type === 'customeridentification.success' || type === 'customeridentification.failed') {
    const customerCode = event.data?.customer?.customer_code
    if (customerCode) {
      await applyIdentificationWebhook(customerCode, type, event.data?.message ?? null)
    }
  } else if (
    type === 'transfer.success' ||
    type === 'transfer.failed' ||
    type === 'transfer.reversed'
  ) {
    if (event.data?.reference) {
      await applyTransferWebhook(
        event.data.reference,
        type,
        event.data?.reason ?? event.data?.message ?? null,
      )
    }
  }

  // Always 200 on a well-formed, signed request; Paystack retries non-2xx.
  return new NextResponse('ok', { status: 200 })
}
