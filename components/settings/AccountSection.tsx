'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState } from 'react-dom'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { requestReset, type ActionState } from '@/lib/auth/actions'
import {
  requestAccountDeletion,
  cancelAccountDeletion,
  deleteAccountNow,
  type DeleteAccountState,
} from '@/lib/settings/account'
import type { DeletionBlocker } from '@/lib/settings/deletion-guards'
import { deletionDueAt, daysRemaining } from '@/lib/settings/grace'
import { createClient } from '@/lib/supabase/client'
import { formatNaira } from '@/lib/format'

export function AccountSection({
  email,
  kycVerified,
  username,
  deletionRequestedAt,
}: {
  email: string
  kycVerified: boolean
  username: string | null
  deletionRequestedAt: string | null
}) {
  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">Account</h2>
      <div className="mt-3 space-y-3 border-t border-sx-border pt-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-sx-gray">Email</span>
          <span className="text-white">{email}</span>
        </div>
        <ChangePasswordButton email={email} />
      </div>

      <div className="mt-5 border-t border-sx-border pt-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-sx-gray">KYC Status</h3>
        {kycVerified ? (
          <p className="text-sm font-semibold text-emerald-400">✅ Account Verified — withdrawal enabled</p>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-amber-400">⚠ Not yet verified — verify to unlock withdrawals</p>
            <Link href="/dashboard/wallet/payment-methods" className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
              Verify Now →
            </Link>
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-red-900/40 pt-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-red-400">Danger Zone</h3>
        {deletionRequestedAt ? (
          <PendingDeletionPanel requestedAt={deletionRequestedAt} />
        ) : (
          <DeleteAccountPanel username={username} />
        )}
      </div>
    </section>
  )
}

function BlockerList({ blockers }: { blockers: DeletionBlocker[] }) {
  const t = useTranslations('accountDeletion')
  return (
    <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-3">
      <p className="text-xs font-bold text-amber-300">{t('blockedTitle')}</p>
      <ul className="mt-2 space-y-1.5">
        {blockers.map((b) => (
          <li key={b.code} className="flex gap-2 text-xs text-amber-100/90">
            <span aria-hidden>•</span>
            <span>
              {b.code === 'wallet_balance' && t('blockerWalletBalance', { amount: formatNaira(b.amount) })}
              {b.code === 'pending_withdrawal' && t('blockerWithdrawal', { count: b.count })}
              {b.code === 'open_escrow_order' && t('blockerEscrow', { count: b.count })}
              {b.code === 'active_listing' && t('blockerListing', { count: b.count })}
              {b.code === 'active_tournament' && t('blockerTournament')}
              {b.code === 'unfinished_match' && t('blockerMatch', { count: b.count })}
              {b.code === 'unfinished_friendly' && t('blockerFriendly', { count: b.count })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Shown while the account is in its grace period. Replaces the delete controls
// entirely: the only action that makes sense here is cancelling.
function PendingDeletionPanel({ requestedAt }: { requestedAt: string }) {
  const t = useTranslations('accountDeletion')
  const router = useRouter()
  const requested = new Date(requestedAt)
  const due = deletionDueAt(requested)
  const left = daysRemaining(requested, new Date())

  return (
    <div className="space-y-3 rounded-xl border border-red-900/50 bg-red-950/20 p-4">
      <p className="text-sm font-black text-white">{t('pendingHeading')}</p>
      <p className="text-xs leading-relaxed text-red-100/90">
        {t('pendingBody', { date: due.toDateString(), days: left })}
      </p>
      <form
        action={async () => {
          await cancelAccountDeletion()
          router.refresh()
        }}
      >
        <button
          type="submit"
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500"
        >
          {t('bannerCancel')}
        </button>
      </form>
    </div>
  )
}

function DeleteAccountPanel({ username }: { username: string | null }) {
  const t = useTranslations('accountDeletion')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [nowOpen, setNowOpen] = useState(false)
  const [nowText, setNowText] = useState('')

  const [state, formAction] = useFormState<DeleteAccountState, FormData>(
    async (prev, fd) => {
      const result = await requestAccountDeletion(prev, fd)
      // No sign-out here: the user stays signed in precisely so they can
      // cancel during the grace period.
      if (!result?.error && !result?.blockers) router.refresh()
      return result
    },
    undefined,
  )

  const [nowState, nowAction] = useFormState<DeleteAccountState, FormData>(
    async (prev, fd) => {
      const result = await deleteAccountNow(prev, fd)
      if (!result?.error && !result?.blockers) {
        await createClient().auth.signOut()
        router.push('/')
      }
      return result
    },
    undefined,
  )

  const due = deletionDueAt(new Date())

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-900/50 px-4 py-2 text-sm font-bold text-red-400 hover:bg-red-950/30"
      >
        {t('title')}
      </button>
    )
  }

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-2 rounded-xl border border-red-900/50 bg-red-950/10 p-4">
        {/* A date, not a duration — "in 15 days" is far easier to misread than
            a day someone can put in their calendar. */}
        <p className="text-sm font-bold text-white">
          {t('scheduledFor', { date: due.toDateString() })}
        </p>
        <ul className="space-y-1 text-xs leading-relaxed text-sx-gray">
          <li>{t('canCancel')}</li>
          <li>{t('historyKept')}</li>
          {username && <li>{t('usernameRetired', { username })}</li>}
          <li>{t('emailReusable')}</li>
        </ul>

        <label className="block pt-1 text-xs text-sx-gray" htmlFor="confirm-delete">
          {t('typeDelete')}
        </label>
        <input
          id="confirm-delete"
          type="text"
          name="confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="w-full rounded-lg border border-red-900/50 bg-slate-950 px-3 py-2 text-sm text-white"
        />

        {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
        {state?.blockers && <BlockerList blockers={state.blockers} />}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            disabled={confirmText !== 'DELETE'}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-40"
          >
            {t('confirmButton')}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-sx-border px-4 py-2 text-sm text-sx-gray"
          >
            {t('cancel')}
          </button>
        </div>
      </form>

      {/* Secondary by design: skipping the grace period removes the safety net
          that lets someone undo a deletion they regret. */}
      {username && (
        <div className="rounded-xl border border-sx-border p-3">
          {!nowOpen ? (
            <button
              type="button"
              onClick={() => setNowOpen(true)}
              className="text-xs font-semibold text-red-400 underline underline-offset-2 hover:text-red-300"
            >
              {t('deleteNowTitle')}
            </button>
          ) : (
            <form action={nowAction} className="space-y-2">
              <p className="text-xs font-bold text-red-300">{t('deleteNowTitle')}</p>
              <p className="text-xs leading-relaxed text-sx-gray">{t('deleteNowWarning')}</p>
              <label className="block text-xs text-sx-gray" htmlFor="confirm-now">
                {t('deleteNowPrompt', { username })}
              </label>
              <input
                id="confirm-now"
                type="text"
                name="confirm"
                value={nowText}
                onChange={(e) => setNowText(e.target.value)}
                className="w-full rounded-lg border border-red-900/50 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              {nowState?.error && <p className="text-xs text-red-400">{nowState.error}</p>}
              {nowState?.blockers && <BlockerList blockers={nowState.blockers} />}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="submit"
                  disabled={nowText.trim().toLowerCase() !== username.toLowerCase()}
                  className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-40"
                >
                  {t('deleteNowButton')}
                </button>
                <button
                  type="button"
                  onClick={() => setNowOpen(false)}
                  className="rounded-lg border border-sx-border px-4 py-2 text-sm text-sx-gray"
                >
                  {t('cancel')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

function ChangePasswordButton({ email }: { email: string }) {
  // requestReset's ActionState.success is the message string itself (not a
  // boolean) — render it directly rather than a hardcoded string.
  const [state, formAction] = useFormState<ActionState, FormData>(requestReset, undefined)
  return (
    <form action={formAction} className="space-y-1.5">
      <input type="hidden" name="email" value={email} />
      <div className="flex items-center justify-between">
        <span className="text-sx-gray">Password</span>
        <button type="submit" className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
          Change Password →
        </button>
      </div>
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state?.success && <p className="text-xs text-emerald-400">{state.success}</p>}
    </form>
  )
}
