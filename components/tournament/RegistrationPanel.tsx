'use client'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { useState } from 'react'
import { registerForTournament, type RegisterState } from '@/lib/tournaments/actions'
import { joinWaitlist, type JoinWaitlistState } from '@/lib/tournaments/waitlist-actions'
import type { RegView } from '@/lib/tournaments/view'
import { formatNaira } from '@/lib/format'
import { Field } from '@/components/dashboard/FormField'
import { COINS_HALF_ENTRY, COINS_PER_ENTRY, NAIRA_PER_COIN } from '@/lib/coins/value'

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-violet-600 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

const box = 'rounded-2xl border border-slate-800 bg-slate-900 p-5'

export function RegistrationPanel({
  view,
  tournamentId,
  slug,
  fee,
  loginHref,
  prefill,
  hasRules,
  loggedIn,
  coinBalance,
  hasUsername,
}: {
  view: RegView
  tournamentId: string
  slug: string
  fee: number
  loginHref: string
  prefill: { displayName: string; whatsapp: string }
  hasRules: boolean
  loggedIn: boolean
  coinBalance: number
  hasUsername: boolean
}) {
  const bracketHref = `/tournaments/${slug}/bracket`

  if (view === 'guest') {
    return (
      <div className={box}>
        <Link
          href={loginHref}
          className="block w-full rounded-xl bg-violet-600 px-7 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-violet-500"
        >
          {fee === 0 ? 'Register — Free' : `Register — ${formatNaira(fee)}`}
        </Link>
        <p className="mt-2 text-center text-xs text-slate-500">Log in to register and pay.</p>
      </div>
    )
  }

  if (view === 'can_register' || view === 'complete_payment') {
    if (!hasUsername) {
      return (
        <div className={box}>
          <p className="text-sm text-slate-300">Claim your SentinelX username before registering.</p>
          <Link
            href={`/onboarding/username?next=/tournaments/${slug}`}
            className="mt-3 block w-full rounded-xl bg-violet-600 px-7 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-violet-500"
          >
            Choose your username
          </Link>
        </div>
      )
    }
    return (
      <div className={box}>
        <RegisterForm
          tournamentId={tournamentId}
          slug={slug}
          fee={fee}
          prefill={prefill}
          hasRules={hasRules}
          coinBalance={coinBalance}
          isCompletingPayment={view === 'complete_payment'}
        />
      </div>
    )
  }

  if (view === 'waitlisted') {
    return (
      <div className={box}>
        <p className="text-center text-sm font-bold text-amber-400">✓ You&apos;re on the waitlist</p>
        <p className="mt-2 text-center text-xs text-slate-500">
          We&apos;ll reach out on WhatsApp if a spot opens up.
        </p>
      </div>
    )
  }

  if (view === 'registered') {
    return (
      <div className={box}>
        <p className="text-center text-sm font-bold text-emerald-400">✓ You&apos;re registered</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Link
            href="/dashboard"
            className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
          >
            My Dashboard
          </Link>
          <Link
            href={bracketHref}
            className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
          >
            View Bracket
          </Link>
        </div>
      </div>
    )
  }

  const message =
    view === 'full'
      ? 'This tournament is full.'
      : view === 'ended'
        ? 'This tournament has ended.'
        : view === 'invitation_only'
          ? "This tournament is by invitation only. Check your dashboard if you've been invited."
          : 'Registration is closed.'

  // Waitlist only makes sense once the event is underway/closed (view === 'closed'
  // maps to tournament status registration_closed/active) — a merely-full
  // registration_open tournament isn't offered a waitlist here.
  const canOfferWaitlist = view === 'closed'

  return (
    <div className={box}>
      <p className="text-center text-sm font-semibold text-slate-400">{message}</p>
      {view !== 'full' && (
        <Link
          href={bracketHref}
          className="mt-3 block rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
        >
          View Bracket
        </Link>
      )}
      {canOfferWaitlist &&
        (loggedIn ? (
          <div className="mt-4 border-t border-slate-800 pt-4">
            <p className="mb-3 text-center text-xs text-slate-500">
              A registered player drops out sometimes — join the waitlist to be considered as a substitute.
            </p>
            <WaitlistForm tournamentId={tournamentId} prefill={prefill} hasRules={hasRules} />
          </div>
        ) : (
          <Link
            href={loginHref}
            className="mt-3 block rounded-xl border border-slate-700 px-5 py-2.5 text-center text-sm font-bold text-white hover:border-slate-500"
          >
            Log in to join the waitlist
          </Link>
        ))}
    </div>
  )
}

function WaitlistForm({
  tournamentId,
  prefill,
  hasRules,
}: {
  tournamentId: string
  prefill: { displayName: string; whatsapp: string }
  hasRules: boolean
}) {
  const [state, formAction] = useFormState<JoinWaitlistState, FormData>(joinWaitlist, undefined)

  if (state?.success) {
    return <p className="text-center text-sm font-bold text-amber-400">✓ You&apos;re on the waitlist</p>
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <Field name="displayName" label="Display name" defaultValue={prefill.displayName} />
      <Field
        name="whatsapp"
        label="WhatsApp number"
        type="tel"
        defaultValue={prefill.whatsapp}
        placeholder="+234…"
      />
      <Field name="clubName" label="Club name" placeholder="Your in-game club/team" />
      <Field
        name="ignTag"
        label="In-game player ID / tag (optional)"
        placeholder="Your IGN or player tag"
        required={false}
      />
      {hasRules && (
        <label className="flex items-start gap-2 text-xs text-slate-400">
          <input type="checkbox" name="agreedToRules" value="true" required className="mt-0.5 accent-violet-600" />
          <span>I have read and agree to the tournament rules.</span>
        </label>
      )}
      {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        className="w-full rounded-xl border border-amber-500/40 px-7 py-3 text-sm font-bold text-amber-400 transition-colors hover:bg-amber-500/10"
      >
        Join waitlist
      </button>
    </form>
  )
}

type CoinTier = '0' | '500' | '1000'

function RegisterForm({
  tournamentId,
  slug,
  fee,
  prefill,
  hasRules,
  coinBalance,
  isCompletingPayment,
}: {
  tournamentId: string
  slug: string
  fee: number
  prefill: { displayName: string; whatsapp: string }
  hasRules: boolean
  coinBalance: number
  isCompletingPayment: boolean
}) {
  const [state, formAction] = useFormState<RegisterState, FormData>(registerForTournament, undefined)
  const [tier, setTier] = useState<CoinTier>('0')

  // Spec §4: discount only offered at ₦500+ fee, and only once resuming an
  // already-pending (unpaid) registration doesn't apply — a fresh coin
  // deduction on top of an existing pending Paystack attempt would double-charge coins.
  const discountEligible = fee >= 500 && !isCompletingPayment
  const canHalf = discountEligible && coinBalance >= COINS_HALF_ENTRY
  const canFree = discountEligible && coinBalance >= COINS_PER_ENTRY

  const discountNaira = tier === '500' ? Math.round(COINS_HALF_ENTRY * NAIRA_PER_COIN) : tier === '1000' ? Math.round(COINS_PER_ENTRY * NAIRA_PER_COIN) : 0
  const youPay = Math.max(0, fee - discountNaira)
  const label = isCompletingPayment
    ? 'Complete payment →'
    : youPay === 0
      ? 'Pay ₦0 — Confirm Registration'
      : `Register — ${formatNaira(youPay)}`
  const pendingLabel = youPay === 0 ? 'Registering…' : 'Redirecting to payment…'

  return (
    <>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="tournamentId" value={tournamentId} />
        <Field name="displayName" label="Display name" defaultValue={prefill.displayName} />
        <Field
          name="whatsapp"
          label="WhatsApp number"
          type="tel"
          defaultValue={prefill.whatsapp}
          placeholder="+234…"
        />
        <Field name="clubName" label="Club name" placeholder="Your in-game club/team" />
        <Field
          name="ignTag"
          label="In-game player ID / tag (optional)"
          placeholder="Your IGN or player tag"
          required={false}
        />
        {(canHalf || canFree) && (
          <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
            <p className="mb-2 flex items-center justify-between text-xs font-bold text-white">
              <span>🪙 Use SX Coins?</span>
              <span className="font-normal text-slate-500">Your balance: {coinBalance.toLocaleString()} coins</span>
            </p>
            <div className="space-y-1.5 text-sm text-slate-300">
              <label className="flex items-center gap-2">
                <input type="radio" name="coinsUsed" value="0" checked={tier === '0'} onChange={() => setTier('0')} className="accent-violet-600" />
                No discount
              </label>
              {canHalf && (
                <label className="flex items-center gap-2">
                  <input type="radio" name="coinsUsed" value="500" checked={tier === '500'} onChange={() => setTier('500')} className="accent-violet-600" />
                  {COINS_HALF_ENTRY.toLocaleString()} coins — Pay {formatNaira(Math.max(0, fee - Math.round(COINS_HALF_ENTRY * NAIRA_PER_COIN)))} (save {formatNaira(Math.round(COINS_HALF_ENTRY * NAIRA_PER_COIN))})
                </label>
              )}
              {canFree && (
                <label className="flex items-center gap-2">
                  <input type="radio" name="coinsUsed" value="1000" checked={tier === '1000'} onChange={() => setTier('1000')} className="accent-violet-600" />
                  {COINS_PER_ENTRY.toLocaleString()} coins — Free entry (save {formatNaira(Math.round(COINS_PER_ENTRY * NAIRA_PER_COIN))})
                </label>
              )}
            </div>
            <p className="mt-2 text-right text-xs font-bold text-white">You pay: {formatNaira(youPay)}</p>
          </div>
        )}
        {hasRules && (
          <label className="flex items-start gap-2 text-xs text-slate-400">
            <input type="checkbox" name="agreedToRules" value="true" required className="mt-0.5 accent-violet-600" />
            <span>I have read and agree to the tournament rules.</span>
          </label>
        )}
        {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
        {state?.needsUsername && (
          <Link
            href={`/onboarding/username?next=/tournaments/${slug}`}
            className="block text-center text-sm font-bold text-violet-400 hover:text-violet-300"
          >
            Choose your username →
          </Link>
        )}
        <SubmitButton label={label} pendingLabel={pendingLabel} />
      </form>
      <p className="mt-2 text-center text-xs text-slate-500">
        {youPay === 0 && tier !== '0'
          ? 'Free entry — coins cover the full fee.'
          : `Secure payment via Paystack. Entry fee ${formatNaira(youPay)}${tier === '500' ? ' after coin discount' : ''}.`}
      </p>
    </>
  )
}
