'use client'
import Link from 'next/link'
import { useFormState, useFormStatus } from 'react-dom'
import { registerForTournament, type RegisterState } from '@/lib/tournaments/actions'
import type { RegView } from '@/lib/tournaments/view'
import { formatNaira } from '@/lib/format'
import { Field } from '@/components/dashboard/FormField'

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
}: {
  view: RegView
  tournamentId: string
  slug: string
  fee: number
  loginHref: string
  prefill: { displayName: string; whatsapp: string }
}) {
  const bracketHref = `/tournaments/${slug}/bracket`

  if (view === 'guest') {
    return (
      <div className={box}>
        <Link
          href={loginHref}
          className="block w-full rounded-xl bg-violet-600 px-7 py-3.5 text-center text-sm font-bold text-white transition-colors hover:bg-violet-500"
        >
          Register — {formatNaira(fee)}
        </Link>
        <p className="mt-2 text-center text-xs text-slate-500">Log in to register and pay.</p>
      </div>
    )
  }

  if (view === 'can_register' || view === 'complete_payment') {
    return (
      <div className={box}>
        <RegisterForm
          tournamentId={tournamentId}
          prefill={prefill}
          label={
            view === 'complete_payment' ? 'Complete payment →' : `Register — ${formatNaira(fee)}`
          }
        />
        <p className="mt-2 text-center text-xs text-slate-500">
          Secure payment via Paystack. Entry fee {formatNaira(fee)}.
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
        : 'Registration is closed.'

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
    </div>
  )
}

function RegisterForm({
  tournamentId,
  label,
  prefill,
}: {
  tournamentId: string
  label: string
  prefill: { displayName: string; whatsapp: string }
}) {
  const [state, formAction] = useFormState<RegisterState, FormData>(registerForTournament, undefined)
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
      <Field name="ignTag" label="In-game player ID / tag" placeholder="Your IGN or player tag" />
      {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
      <SubmitButton label={label} pendingLabel="Redirecting to payment…" />
    </form>
  )
}
