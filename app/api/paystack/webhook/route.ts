import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/paystack/server'
import { confirmRegistration } from '@/lib/tournaments/confirm'

export const runtime = 'nodejs'

// Machine-to-machine. Fires independently of the user's browser — the reliable
// source of truth for payment status.
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature')

  if (!verifyWebhookSignature(rawBody, signature)) {
    return new NextResponse('Invalid signature', { status: 401 })
  }

  let event: { event?: string; data?: { reference?: string } }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return new NextResponse('Bad payload', { status: 400 })
  }

  if (event.event === 'charge.success' && event.data?.reference) {
    await confirmRegistration(event.data.reference)
  }

  // Always 200 on a well-formed, signed request; Paystack retries non-2xx.
  return new NextResponse('ok', { status: 200 })
}
