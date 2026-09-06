'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import Link from 'next/link'
import { requestReset, type ActionState } from '@/lib/auth/actions'

export function AccountSection({ email, kycVerified }: { email: string; kycVerified: boolean }) {
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
        {/* Deletion is being rebuilt: the old path fails for 82 of 102 users
            because 34 foreign keys onto profiles are NO ACTION, and the schema
            change that fixes it would briefly let the old path orphan a
            fully-populated profile. A notice rather than a silent removal —
            Privacy Policy section 6 commits to honouring deletion requests, so
            users must still be told how to exercise that right meanwhile. */}
        <p className="text-xs leading-relaxed text-sx-gray">
          Account deletion is temporarily unavailable while we rebuild it. To delete your account in
          the meantime, email{' '}
          <a
            href="mailto:sentinelxesports@gmail.com"
            className="font-semibold text-sx-purple-text hover:text-sx-purple-light"
          >
            sentinelxesports@gmail.com
          </a>{' '}
          and we will action it for you.
        </p>
      </div>
    </section>
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

