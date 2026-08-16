'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormState } from 'react-dom'
import Link from 'next/link'
import { requestReset, type ActionState } from '@/lib/auth/actions'
import { deleteAccount, type DeleteAccountState } from '@/lib/settings/account'
import { createClient } from '@/lib/supabase/client'

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
        <DeleteAccountButton />
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

function DeleteAccountButton() {
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const router = useRouter()
  const [state, formAction] = useFormState<DeleteAccountState, FormData>(async (prev, fd) => {
    const result = await deleteAccount(prev, fd)
    if (!result?.error) {
      await createClient().auth.signOut()
      router.push('/')
    }
    return result
  }, undefined)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-900/50 px-4 py-2 text-sm font-bold text-red-400 hover:bg-red-950/30"
      >
        Delete Account
      </button>
    )
  }

  return (
    <form action={formAction} className="space-y-2 rounded-xl border border-red-900/50 bg-red-950/10 p-4">
      <p className="text-sm text-white">This permanently deletes your account and all associated data. Type <strong>DELETE</strong> to confirm.</p>
      <input
        type="text"
        name="confirm"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        className="w-full rounded-lg border border-red-900/50 bg-slate-950 px-3 py-2 text-sm text-white"
      />
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={confirmText !== 'DELETE'}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-40"
        >
          Permanently Delete
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-sx-border px-4 py-2 text-sm text-sx-gray">
          Cancel
        </button>
      </div>
    </form>
  )
}
