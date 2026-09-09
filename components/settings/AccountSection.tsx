'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState } from 'react-dom'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { requestReset, changeEmail, type ActionState, type ChangeEmailState } from '@/lib/auth/actions'
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
  pendingEmail,
  hasPassword,
  hasGoogle,
  emailJustChanged,
}: {
  email: string
  kycVerified: boolean
  username: string | null
  deletionRequestedAt: string | null
  // Set while an email change is awaiting confirmation. Supabase keeps the new
  // address here and leaves the account on the old one until the link is opened.
  pendingEmail: string | null
  hasPassword: boolean
  hasGoogle: boolean
  emailJustChanged: boolean
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
        {/* Below Change Password on purpose — the Google-only message tells
            people to use that button, and "above" should be true. */}
        <ChangeEmailPanel
          pendingEmail={pendingEmail}
          hasPassword={hasPassword}
          hasGoogle={hasGoogle}
          justChanged={emailJustChanged}
        />
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

function ChangeEmailPanel({
  pendingEmail,
  hasPassword,
  hasGoogle,
  justChanged,
}: {
  pendingEmail: string | null
  hasPassword: boolean
  hasGoogle: boolean
  justChanged: boolean
}) {
  const t = useTranslations('emailChange')
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const [state, formAction] = useFormState<ChangeEmailState, FormData>(async (prev, fd) => {
    const result = await changeEmail(prev, fd)
    // Brings the pending-address row down from the server without a reload.
    if (result?.sentTo) router.refresh()
    return result
  }, undefined)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sx-gray">{t('title')}</span>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light"
          >
            {t('open')}
          </button>
        )}
      </div>

      {justChanged && !pendingEmail && (
        <p className="text-xs text-emerald-400">{t('changed')}</p>
      )}

      {pendingEmail && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2">
          <p className="text-xs font-semibold text-amber-300">{t('pending', { email: pendingEmail })}</p>
          <p className="mt-0.5 text-xs text-amber-100/80">{t('pendingHint')}</p>
        </div>
      )}

      {open && (
        <form action={formAction} className="space-y-2 rounded-xl border border-sx-border bg-slate-950/40 p-3">
          {/* A hint, not a gate. Setting a password through the reset flow
              leaves no 'email' identity behind, so accounts that DO have a
              password can land here looking like they don't — the server
              decides, by trying the password first. */}
          {!hasPassword && (
            <p className="rounded-lg border border-sx-border bg-slate-950/60 px-3 py-2 text-xs leading-relaxed text-sx-gray">
              {t('googleHint')}
            </p>
          )}
          <label className="block text-xs text-sx-gray" htmlFor="new-email">
            {t('newLabel')}
          </label>
          <input
            id="new-email"
            type="email"
            name="email"
            autoComplete="email"
            required
            className="w-full rounded-lg border border-sx-border bg-slate-950 px-3 py-2 text-sm text-white"
          />

          <label className="block pt-1 text-xs text-sx-gray" htmlFor="current-password">
            {t('passwordLabel')}
          </label>
          <input
            id="current-password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-sx-border bg-slate-950 px-3 py-2 text-sm text-white"
          />
          <p className="text-xs leading-relaxed text-sx-gray">{t('passwordHint')}</p>
          {/* Said here, not only in Sign-in methods: this is the moment someone
              assumes the old address has lost its access. It hasn't. */}
          {hasGoogle && (
            <p className="text-xs leading-relaxed text-amber-200/80">{t('googleSurvives')}</p>
          )}

          {state?.errorCode && <p className="text-xs text-red-400">{t(`errors.${state.errorCode}`)}</p>}
          {state?.sentTo && (
            <div className="space-y-0.5">
              <p className="text-xs text-emerald-400">{t('sent', { email: state.sentTo })}</p>
              <p className="text-xs text-sx-gray">{t('sentSpam')}</p>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1 sm:flex-row">
            <button
              type="submit"
              className="rounded-lg bg-sx-purple px-4 py-2 text-sm font-bold text-white hover:bg-sx-purple-light"
            >
              {t('submit')}
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
      )}
    </div>
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
