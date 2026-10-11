import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { ApiError, Errors } from '../errors'
import { decodeCursor } from '../history-cursor'
import { loadWalletOverview } from '@/lib/wallet/overview'
import { loadTransactionsPage, parseFilter } from '@/lib/wallet/transactions-page'
import { loadWithdrawalsPage } from '@/lib/wallet/withdrawals-page'
import { startDeposit } from '@/lib/wallet/deposit-service'
import { submitWithdrawal } from '@/lib/wallet/withdrawal-service'
import { confirmWalletDeposit } from '@/lib/wallet/confirm'
import { getWalletBalance } from '@/lib/wallet/service'
import { resolvePayout, savePayoutAccount, clearPayoutAccount } from '@/lib/kyc/payout-service'
import { listBanks } from '@/lib/paystack/server'
import {
  hitLimit,
  DEPOSIT_START_LIMIT,
  DEPOSIT_POLL_LIMIT,
  RESOLVE_LIMIT,
  depositKey,
  depositPollKey,
  resolveKey,
} from '@/lib/rate-limit/account-limiter'

// Every operation here is owner-scoped: the player id is always ctx.userId, never a body, path or query value.
// Responses carry only the MASKED payout account number and never admin_note.

// Same bounds as the web walletDepositSchema / walletWithdrawalSchema (whole naira, 100 to 100,000,000).
const amount = z.number().int().min(100).max(100_000_000)

const payoutAccount = z.object({ bankName: z.string(), accountName: z.string(), accountNumberMasked: z.string() })

const txn = z.object({
  id: z.string(),
  type: z.string(),
  category: z.string().nullable(),
  amount: z.number().int(),
  createdAt: z.string(),
  status: z.enum(['completed', 'pending', 'failed']),
})

const cursorParam = { name: 'cursor', in: 'query', required: false, description: 'Opaque cursor from a previous nextCursor.', schema: { type: 'string' } } as const

function readCursor(req: Request): { t: string; id: string } | null {
  const raw = new URL(req.url).searchParams.get('cursor')
  return raw ? decodeCursor(raw) : null // rejects with 400 invalid_cursor before any query is built
}

const payoutBody = z.object({
  bankCode: z.string().trim().min(1).max(20),
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Account number must be 10 digits'),
})

const deletionBlocked = () =>
  new ApiError(403, 'account_pending_deletion', 'Cancel your account deletion in Settings to do this.')

export const getMyWalletEndpoint = defineEndpoint({
  operationId: 'getMyWallet',
  method: 'GET',
  path: '/wallet',
  summary: "The signed-in player's wallet: balance, pending withdrawal, earnings, recent transactions and masked payout account.",
  auth: 'user',
  response: z.object({
    balance: z.number().int(),
    coinBalance: z.number().int(),
    pendingWithdrawal: z.number().int(),
    earnings: z.object({
      tournamentPrize: z.number().int(),
      referral: z.number().int(),
      bonus: z.number().int(),
      tournamentPrizeTrendPct: z.number().int().nullable(),
    }),
    recentTransactions: z.array(txn),
    payoutAccount: payoutAccount.nullable(),
    kycVerified: z.boolean(),
    activeWithdrawal: z.object({ id: z.string(), amount: z.number().int(), requestedAt: z.string() }).nullable(),
  }),
  handler: async ({ ctx }) => {
    const result = await loadWalletOverview(ctx.admin, ctx.userId)
    if (!result.ok) throw new ApiError(500, 'wallet_load_failed', 'Could not load your wallet.')
    return result.value
  },
})

export const listMyWalletTransactionsEndpoint = defineEndpoint({
  operationId: 'listMyWalletTransactions',
  method: 'GET',
  path: '/wallet/transactions',
  summary: "The signed-in player's wallet ledger, newest first, 20 per page, keyset cursor. filter: all | winnings | withdrawals | deposits.",
  auth: 'user',
  parameters: [
    { name: 'filter', in: 'query', required: false, schema: { type: 'string', enum: ['all', 'winnings', 'withdrawals', 'deposits'] } },
    cursorParam,
  ],
  response: z.object({ items: z.array(txn), nextCursor: z.string().nullable() }),
  handler: async ({ ctx, req }) => {
    const cursor = readCursor(req)
    const filter = parseFilter(new URL(req.url).searchParams.get('filter'))
    const result = await loadTransactionsPage(ctx.admin, ctx.userId, { filter, cursor })
    if (!result.ok) throw new ApiError(500, 'wallet_load_failed', 'Could not load your transactions.')
    return { items: result.items, nextCursor: result.nextCursor }
  },
})

export const listWalletBanksEndpoint = defineEndpoint({
  operationId: 'listWalletBanks',
  method: 'GET',
  path: '/wallet/banks',
  summary: 'Nigerian banks a payout account can be added at (name and code).',
  auth: 'user',
  response: z.object({ banks: z.array(z.object({ name: z.string(), code: z.string() })) }),
  handler: async () => {
    try {
      const banks = await listBanks()
      return { banks: banks.map((b) => ({ name: b.name, code: b.code })) }
    } catch (err) {
      console.error('[wallet] listBanks failed', { message: err instanceof Error ? err.message : String(err) })
      throw new ApiError(503, 'payout_unavailable', 'Banks are unavailable right now. Please try again.')
    }
  },
})

export const resolvePayoutAccountEndpoint = defineEndpoint({
  operationId: 'resolvePayoutAccount',
  method: 'POST',
  path: '/wallet/payout-account/resolve',
  summary: 'Look up the account holder name for a bank account so the player can confirm it. Limited to 10 per 15 minutes.',
  auth: 'user',
  body: payoutBody,
  response: z.object({ accountName: z.string() }),
  handler: async ({ ctx, body }) => {
    const gate = await hitLimit(ctx.admin, { key: resolveKey(ctx.userId), ...RESOLVE_LIMIT })
    if (!gate.allowed) throw Errors.rateLimited(gate.retryAfterSeconds)
    const result = await resolvePayout(body)
    if (result.ok) return { accountName: result.accountName }
    if (result.reason === 'validation') throw Errors.validation({ accountNumber: 'Account number must be 10 digits' })
    throw new ApiError(422, 'account_unresolvable', 'We could not verify this account number. Check the details and try again.')
  },
})

export const setPayoutAccountEndpoint = defineEndpoint({
  operationId: 'setPayoutAccount',
  method: 'PUT',
  path: '/wallet/payout-account',
  summary: 'Add the payout account. The account and bank names are resolved on the server; only the masked number is returned.',
  auth: 'user',
  body: payoutBody,
  response: z.object({ payoutAccount }),
  handler: async ({ ctx, body }) => {
    // A save spends a Paystack account resolve too, so it shares the resolve limit (otherwise PUT bypasses it).
    const gate = await hitLimit(ctx.admin, { key: resolveKey(ctx.userId), ...RESOLVE_LIMIT })
    if (!gate.allowed) throw Errors.rateLimited(gate.retryAfterSeconds)
    const result = await savePayoutAccount(ctx.admin, { playerId: ctx.userId, bankCode: body.bankCode, accountNumber: body.accountNumber })
    if (result.ok) return { payoutAccount: result.payoutAccount }
    switch (result.reason) {
      case 'already_verified':
        throw new ApiError(409, 'already_verified', 'A payout account is already saved. Remove it first to change it.')
      case 'account_unresolvable':
        throw new ApiError(422, 'account_unresolvable', 'We could not verify this account number. Check the details and try again.')
      case 'unknown_bank':
        throw new ApiError(422, 'unknown_bank', 'We do not recognise that bank. Select your bank again.')
      case 'pending_deletion':
        throw deletionBlocked()
      case 'validation':
        throw Errors.validation({ accountNumber: 'Account number must be 10 digits' })
      default:
        throw new ApiError(503, 'payout_unavailable', 'Payout accounts are unavailable right now. Please try again.')
    }
  },
})

export const removePayoutAccountEndpoint = defineEndpoint({
  operationId: 'removePayoutAccount',
  method: 'DELETE',
  path: '/wallet/payout-account',
  summary: 'Remove the saved payout account. A pending withdrawal keeps its own snapshot of the account it was filed with.',
  auth: 'user',
  response: z.object({ removed: z.literal(true) }),
  handler: async ({ ctx }) => {
    const result = await clearPayoutAccount(ctx.admin, ctx.userId)
    if (!result.ok) throw new ApiError(500, 'payout_remove_failed', 'Could not remove your payout account. Please try again.')
    return { removed: true as const }
  },
})

export const startWalletDepositEndpoint = defineEndpoint({
  operationId: 'startWalletDeposit',
  method: 'POST',
  path: '/wallet/deposits',
  summary: 'Start a Paystack wallet top-up. Returns the checkout URL; the wallet is credited only after Paystack confirms. Limited to 10 per hour.',
  auth: 'user',
  idempotent: true,
  body: z.object({ amount }),
  response: z.object({
    reference: z.string(),
    authorizationUrl: z.string(),
    amount: z.number().int(),
    fee: z.number().int(),
    total: z.number().int(),
  }),
  handler: async ({ ctx, body }) => {
    const gate = await hitLimit(ctx.admin, { key: depositKey(ctx.userId), ...DEPOSIT_START_LIMIT })
    if (!gate.allowed) throw Errors.rateLimited(gate.retryAfterSeconds)
    const result = await startDeposit(ctx.admin, { playerId: ctx.userId, email: ctx.email, amount: body.amount })
    if (result.ok) {
      return { reference: result.reference, authorizationUrl: result.authorizationUrl, amount: result.amount, fee: result.fee, total: result.total }
    }
    switch (result.reason) {
      case 'pending_deletion':
        throw deletionBlocked()
      case 'email_required':
        throw new ApiError(422, 'email_required', 'Add an email to your account to pay.')
      case 'paystack_failed':
        throw new ApiError(502, 'payment_unavailable', 'Payment could not be started. Please try again.')
      default:
        throw new ApiError(500, 'deposit_failed', 'Could not start your top-up. Please try again.')
    }
  },
})

export const getWalletDepositEndpoint = defineEndpoint({
  operationId: 'getWalletDeposit',
  method: 'GET',
  path: '/wallet/deposits/{reference}',
  summary: "Poll one of the signed-in player's wallet deposits. The webhook stays the source of truth; this is UI polling and is safe to repeat.",
  auth: 'user',
  parameters: [{ name: 'reference', in: 'path', required: true, schema: { type: 'string' } }],
  response: z.object({
    status: z.enum(['confirmed', 'already_paid', 'not_successful', 'not_found']),
    balance: z.number().int().nullable(),
  }),
  handler: async ({ ctx, params }) => {
    // Ownership first: another player's reference answers exactly like an unknown one and never reaches Paystack.
    const { data } = await ctx.admin
      .from('wallet_deposits')
      .select('id')
      .eq('paystack_reference', params.reference)
      .eq('player_id', ctx.userId)
      .maybeSingle()
    if (!data) return { status: 'not_found' as const, balance: null }
    // Each poll can call Paystack's verify API, so polling is limited per player (after ownership, before Paystack).
    const gate = await hitLimit(ctx.admin, { key: depositPollKey(ctx.userId), ...DEPOSIT_POLL_LIMIT })
    if (!gate.allowed) throw Errors.rateLimited(gate.retryAfterSeconds)
    const status = await confirmWalletDeposit(params.reference)
    const credited = status === 'confirmed' || status === 'already_paid'
    return { status, balance: credited ? await getWalletBalance(ctx.admin, ctx.userId) : null }
  },
})

export const requestWithdrawalEndpoint = defineEndpoint({
  operationId: 'requestWithdrawal',
  method: 'POST',
  path: '/wallet/withdrawals',
  summary: 'Request a withdrawal to the saved payout account. Paid out manually by an administrator.',
  auth: 'user',
  idempotent: true,
  body: z.object({ amount }),
  response: z.object({
    id: z.string(),
    amount: z.number().int(),
    status: z.literal('pending'),
    requestedAt: z.string(),
    payoutAccount,
  }),
  handler: async ({ ctx, body }) => {
    const result = await submitWithdrawal(ctx.admin, { playerId: ctx.userId, amount: body.amount })
    if (result.ok) {
      return { id: result.id, amount: result.amount, status: 'pending' as const, requestedAt: result.requestedAt, payoutAccount: result.payoutAccount }
    }
    switch (result.reason) {
      case 'kyc_required':
        throw new ApiError(422, 'kyc_required', 'Add a payout account before requesting a withdrawal.')
      case 'insufficient_balance':
        throw new ApiError(422, 'insufficient_balance', 'That amount is more than your available balance.')
      case 'withdrawal_pending':
        throw new ApiError(409, 'withdrawal_pending', 'You already have a pending withdrawal request.')
      case 'pending_deletion':
        throw deletionBlocked()
      default:
        throw new ApiError(500, 'withdrawal_failed', 'Could not submit your request. Please try again.')
    }
  },
})

export const listMyWithdrawalsEndpoint = defineEndpoint({
  operationId: 'listMyWithdrawals',
  method: 'GET',
  path: '/wallet/withdrawals',
  summary: "The signed-in player's withdrawal requests, newest first, 20 per page. Staff notes are never returned.",
  auth: 'user',
  parameters: [cursorParam],
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        amount: z.number().int(),
        status: z.enum(['pending', 'paid', 'rejected']),
        requestedAt: z.string(),
        resolvedAt: z.string().nullable(),
        payoutAccount,
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  handler: async ({ ctx, req }) => {
    const cursor = readCursor(req)
    const result = await loadWithdrawalsPage(ctx.admin, ctx.userId, { cursor })
    if (!result.ok) throw new ApiError(500, 'wallet_load_failed', 'Could not load your withdrawals.')
    return {
      items: result.items.map((i) => ({ ...i, status: i.status as 'pending' | 'paid' | 'rejected' })),
      nextCursor: result.nextCursor,
    }
  },
})
