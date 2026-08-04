'use client'
import { useFormState, useFormStatus } from 'react-dom'
import {
  acceptMastersInvitation,
  declineMastersInvitation,
  type InvitationResponseState,
} from '@/lib/seasons/player-actions'
import { formatNaira } from '@/lib/format'

function AcceptButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-1 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Processing…' : 'Accept & Pay'}
    </button>
  )
}

export function MastersInvitationBanner({
  invitation,
}: {
  invitation: { id: string; rank: number; deadline: string; tournamentTitle: string; fee: number }
}) {
  const [acceptState, acceptAction] = useFormState<InvitationResponseState, FormData>(acceptMastersInvitation, undefined)
  const [declineState, declineAction] = useFormState<InvitationResponseState, FormData>(declineMastersInvitation, undefined)

  if (declineState?.success) return null

  return (
    <div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
      <p className="text-sm font-bold text-amber-300">🏆 You&apos;ve been invited to {invitation.tournamentTitle}!</p>
      <p className="mt-1 text-xs text-slate-300">
        You ranked #{invitation.rank}. {invitation.fee > 0 ? `Entry fee: ${formatNaira(invitation.fee)}.` : 'Free entry.'}
      </p>
      <p className="text-xs text-slate-400">
        Deadline: {new Date(invitation.deadline).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
      <div className="mt-3 flex gap-2">
        <form action={acceptAction} className="flex-1">
          <input type="hidden" name="invitationId" value={invitation.id} />
          <AcceptButton />
        </form>
        <form action={declineAction}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <button
            type="submit"
            className="rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-slate-300 hover:border-slate-500"
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
