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

export function buildFriendlyStakeReference(friendlyMatchId: string, userId: string): string {
  const m = friendlyMatchId.replace(/-/g, '').slice(0, 8)
  const u = userId.replace(/-/g, '').slice(0, 8)
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `sxfm_${m}_${u}_${rand}`
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

export interface Bank {
  name: string
  code: string
}

// Paystack secret keys are prefixed sk_test_ / sk_live_ — this is the one
// place that distinction matters in the app: surfacing the sandbox-only test
// bank (see listBanks below) that must never appear once live keys are set.
export function isTestModeKey(key: string): boolean {
  return key.startsWith('sk_test_')
}

// Paystack's real /bank list never includes this — it's a sandbox-only bank
// (code 001) that resolves any account number to a canned test name without
// counting against test mode's daily "3 live bank resolves" cap. Injected
// only in test mode so KYC testing isn't blocked by that cap; isTestModeKey
// keeps it from ever reaching a live deployment.
const TEST_BANK: Bank = { name: 'Test Bank (Paystack sandbox)', code: '001' }

export async function listBanks(): Promise<Bank[]> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/bank?country=nigeria&currency=NGN&type=nuban`, {
    headers: { Authorization: `Bearer ${secret()}` },
    next: { revalidate: 86400 },
  })
  const json = await res.json()
  if (!res.ok || !json.status) throw new Error(json?.message || 'Paystack bank list failed')
  const banks = (json.data as Array<{ name: string; code: string }>).map((b) => ({
    name: b.name,
    code: b.code,
  }))
  return isTestModeKey(secret()) ? [TEST_BANK, ...banks] : banks
}

export interface ResolvedAccount {
  accountName: string
}

export async function resolveAccount(
  accountNumber: string,
  bankCode: string,
): Promise<ResolvedAccount> {
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    { headers: { Authorization: `Bearer ${secret()}` }, cache: 'no-store' },
  )
  const json = await res.json()
  if (!res.ok || !json.status) {
    throw new Error(json?.message || 'Could not resolve this account number')
  }
  return { accountName: json.data.account_name as string }
}

export async function createCustomer(
  email: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/customer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, first_name: firstName, last_name: lastName }),
  })
  const json = await res.json()
  if (!res.ok || !json.status) throw new Error(json?.message || 'Paystack customer creation failed')
  return json.data.customer_code as string
}

export function buildIdentificationPayload(params: {
  bvn: string
  bankCode: string
  accountNumber: string
  firstName: string
  lastName: string
}) {
  return {
    country: 'NG',
    type: 'bank_account',
    bvn: params.bvn,
    bank_code: params.bankCode,
    account_number: params.accountNumber,
    first_name: params.firstName,
    last_name: params.lastName,
  }
}

export async function submitBvnIdentification(
  customerCode: string,
  params: { bvn: string; bankCode: string; accountNumber: string; firstName: string; lastName: string },
): Promise<void> {
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/customer/${encodeURIComponent(customerCode)}/identification`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildIdentificationPayload(params)),
    },
  )
  const json = await res.json()
  if (!res.ok || !json.status) {
    throw new Error(json?.message || 'Paystack identification submission failed')
  }
}

export function buildRecipientPayload(params: {
  accountName: string
  accountNumber: string
  bankCode: string
}) {
  return {
    type: 'nuban',
    name: params.accountName,
    account_number: params.accountNumber,
    bank_code: params.bankCode,
    currency: 'NGN',
  }
}

export async function createTransferRecipient(params: {
  accountName: string
  accountNumber: string
  bankCode: string
}): Promise<string> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/transferrecipient`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRecipientPayload(params)),
  })
  const json = await res.json()
  if (!res.ok || !json.status) throw new Error(json?.message || 'Paystack recipient creation failed')
  return json.data.recipient_code as string
}

export function buildTransferReference(withdrawalId: string): string {
  const w = withdrawalId.replace(/-/g, '').slice(0, 12)
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
  return `sxwd_${w}_${rand}`
}

export function buildTransferPayload(params: {
  amountKobo: number
  recipientCode: string
  reference: string
}) {
  return {
    source: 'balance',
    amount: params.amountKobo,
    recipient: params.recipientCode,
    reason: 'SentinelX prize withdrawal',
    reference: params.reference,
  }
}

export async function initiateTransfer(params: {
  amountKobo: number
  recipientCode: string
  reference: string
}): Promise<{ transferCode: string }> {
  const res = await fetch(`${PAYSTACK_BASE_URL}/transfer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTransferPayload(params)),
  })
  const json = await res.json()
  if (!res.ok || !json.status) throw new Error(json?.message || 'Paystack transfer initiation failed')
  return { transferCode: json.data.transfer_code as string }
}
