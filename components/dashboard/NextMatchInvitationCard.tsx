'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { acceptMastersInvitation, declineMastersInvitation, type InvitationResponseState } from '@/lib/seasons/player-actions'
import { formatNaira } from '@/lib/format'

function AcceptButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-1 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-60"
    >
      {pending ? 'Processing…' : 'Accept & Pay'}
    </button>
  )
}

// Dashboard Section 2, State C — spec §2: replaces the NextMatchCard slot
// entirely (same position, same prominence) when a Masters/Champions Cup
// invitation is pending.
export function NextMatchInvitationCard({
  invitation,
}: {
  invitation: { id: string; rank: number; deadline: string; tournamentTitle: string; fee: number }
}) {
  const [acceptState, acceptAction] = useFormState<InvitationResponseState, FormData>(acceptMastersInvitation, undefined)
  const [declineState, declineAction] = useFormState<InvitationResponseState, FormData>(declineMastersInvitation, undefined)

  if (declineState?.success) return null

  const hoursLeft = Math.max(0, Math.round((new Date(invitation.deadline).getTime() - Date.now()) / 3_600_000))

  return (
    <div
      className="rounded-2xl border border-amber-500/50 bg-sx-surface p-5"
      style={{ boxShadow: '0 0 24px rgba(245,158,11,0.25)' }}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-amber-300">🏆 You&apos;ve been invited to {invitation.tournamentTitle}!</p>
        <span className="text-xs font-bold uppercase text-amber-400">Expires in {hoursLeft}h</span>
      </div>
      <p className="mt-1 text-sm text-sx-gray">
        You ranked #{invitation.rank} in {new Date().toLocaleDateString('en-US', { month: 'long' })}.{' '}
        {invitation.fee > 0 ? `Entry fee: ${formatNaira(invitation.fee)}.` : 'Free entry.'}
      </p>
      <div className="mt-4 flex gap-2">
        <form action={acceptAction} className="flex-1">
          <input type="hidden" name="invitationId" value={invitation.id} />
          <AcceptButton />
        </form>
        <form action={declineAction}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <button
            type="submit"
            className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-bold text-slate-300 hover:border-slate-500"
          >
            Decline
          </button>
        </form>
      </div>
      {(acceptState?.error || declineState?.error) && (
        <p className="mt-2 text-xs text-red-400">{acceptState?.error ?? declineState?.error}</p>
      )}
    </div>
  )
}
