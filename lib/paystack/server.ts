// Server-only. Never import from client components — reads PAYSTACK_SECRET_KEY.
import { createHmac, timingSafeEqual } from 'crypto'
import { PAYSTACK_BASE_URL } from './index'

function secret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set')
  return key
}

export function buildReference(tournamentId: string, userId: string): string {
  const t = tournamentId.replace(/-/g, '').slice(0, 8)
  const u = userId.replace(/-/g, '').slice(0, 8)
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `sx_${t}_${u}_${rand}`
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false
  const expected = createHmac('sha512', secret()).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface InitializeParams {
  email: string
  amountKobo: number
  reference: string
  callbackUrl: string
  metadata?: Record<string, unknown>
}

export async function initializeTransaction(params: InitializeParams): Promise<string> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amountKobo,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata ?? {},
    }),
  })
  const json = await res.json()
  if (!res.ok || !json.status) {
    throw new Error(json?.message || 'Paystack initialize failed')
  }
  return json.data.authorization_url as string
}

export interface VerifyResult {
  status: string
  amountKobo: number
  reference: string
}

export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${secret()}` },
      cache: 'no-store',
    },
  )
  const json = await res.json()
  if (!res.ok || !json.status) {
    throw new Error(json?.message || 'Paystack verify failed')
  }
  return {
    status: json.data.status,
    amountKobo: json.data.amount,
    reference: json.data.reference,
  }
}
