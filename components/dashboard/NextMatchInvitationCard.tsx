'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { acceptMastersInvitation, declineMastersInvitation, type InvitationResponseState } from '@/lib/seasons/player-actions'
import { formatNaira } from '@/lib/format'
import Link from 'next/link'

function AcceptButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-60"
    >
      {pending ? 'Processing…' : label}
    </button>
  )
}

function DeclineButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-bold text-slate-300 hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? 'Declining…' : 'Decline'}
    </button>
  )
}

// Dashboard Section 2, State C — spec §2: replaces the NextMatchCard slot
// entirely (same position, same prominence) when a Masters/Champions Cup
// invitation is pending.
export function NextMatchInvitationCard({
  invitation,
  walletBalance,
}: {
  invitation: { id: string; rank: number; deadline: string; tournamentTitle: string; fee: number; status: string; slug: string }
  walletBalance: number
}) {
  const [acceptState, acceptAction] = useFormState<InvitationResponseState, FormData>(acceptMastersInvitation, undefined)
  const [declineState, declineAction] = useFormState<InvitationResponseState, FormData>(declineMastersInvitation, undefined)

  if (declineState?.success) return null

  const hoursLeft = Math.max(0, Math.round((new Date(invitation.deadline).getTime() - Date.now()) / 3_600_000))
  const accepted = invitation.status === 'accepted'

  return (
    <div
      className="rounded-2xl border border-amber-500/50 bg-sx-surface p-5"
      style={{ boxShadow: '0 0 24px rgba(245,158,11,0.25)' }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-amber-300">🏆 {accepted ? 'Payment pending for' : 'You\'ve been invited to'} {invitation.tournamentTitle}!</p>
        {!accepted && <span className="text-xs font-bold uppercase text-amber-400">Expires in {hoursLeft}h</span>}
      </div>
      <p className="mt-1 text-sm text-sx-gray">
        {accepted ? 'Your spot is reserved. Complete payment to confirm entry. ' : invitation.rank > 0 ? `You ranked #${invitation.rank}. ` : ''}
        {invitation.fee > 0 ? `Entry fee: ${formatNaira(invitation.fee)}.` : 'Free entry.'}
      </p>
      {invitation.fee > 0 && <p className="mt-2 text-xs text-sx-gray">Wallet balance: {formatNaira(walletBalance)}</p>}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {invitation.fee > 0 && walletBalance >= invitation.fee && (
          <form action={acceptAction} className="flex-1">
            <input type="hidden" name="invitationId" value={invitation.id} />
            <input type="hidden" name="paymentMethod" value="wallet" />
            <AcceptButton label={`Pay ${formatNaira(invitation.fee)} from wallet`} />
          </form>
        )}
        <form action={acceptAction} className="flex-1">
          <input type="hidden" name="invitationId" value={invitation.id} />
          <input type="hidden" name="paymentMethod" value="paystack" />
          <AcceptButton label={invitation.fee > 0 ? 'Pay with Paystack' : 'Accept free entry'} />
        </form>
        {!accepted && <form action={declineAction}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <DeclineButton />
        </form>}
      </div>
      {invitation.fee > walletBalance && <Link href="/dashboard/wallet" className="mt-2 block text-xs font-semibold text-amber-300">Add money to your wallet →</Link>}
      <Link href={`/tournaments/${invitation.slug}`} className="mt-2 block text-xs text-sx-gray underline">View tournament</Link>
      {(acceptState?.error || declineState?.error) && (
        <p className="mt-2 text-xs text-red-400">{acceptState?.error ?? declineState?.error}</p>
      )}
    </div>
  )
}
