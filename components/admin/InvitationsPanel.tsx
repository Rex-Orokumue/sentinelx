'use client'
import { useFormState, useFormStatus } from 'react-dom'
import {
  sendInvitations,
  triggerCascadeNow,
  reinviteExpiredInvitations,
  manuallyAddInvitee,
  resendInvitation,
  type InvitationActionState,
} from '@/lib/seasons/invitation-actions'
import { canRecordManualPayment } from '@/lib/seasons/manual-payment-policy'
import { ManualPaymentForm } from './ManualPaymentForm'

interface InvitationRow {
  id: string
  playerId: string
  username: string
  playerName: string
  rank: number
  status: string
  invitedAt: string
  expiresAt: string
  paymentStatus: string | null
  paymentSource: string | null
  registrationStatus: string | null
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-amber-400',
  accepted: 'text-emerald-400',
  declined: 'text-slate-500',
  expired: 'text-red-400',
}

function ActionButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:border-slate-500 disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

export function InvitationsPanel({ tournamentId, tournamentStatus, registrationFee, isAdmin, invitations }: {
  tournamentId: string
  tournamentStatus: string
  registrationFee: number
  isAdmin: boolean
  invitations: InvitationRow[]
}) {
  const [sendState, sendAction] = useFormState<InvitationActionState, FormData>(sendInvitations, undefined)
  const [cascadeState, cascadeAction] = useFormState<InvitationActionState, FormData>(triggerCascadeNow, undefined)
  const [reinviteState, reinviteAction] = useFormState<InvitationActionState, FormData>(reinviteExpiredInvitations, undefined)
  const [addState, addAction] = useFormState<InvitationActionState, FormData>(manuallyAddInvitee, undefined)
  const [resendState, resendAction] = useFormState<InvitationActionState, FormData>(resendInvitation, undefined)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <form action={sendAction}>
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <ActionButton label="Send Invitations" pendingLabel="Sending…" />
        </form>
        <form action={cascadeAction}>
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <ActionButton label="Check & Cascade Now" pendingLabel="Checking…" />
        </form>
        <form action={reinviteAction}>
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <ActionButton label="Re-invite expired & fill" pendingLabel="Re-inviting…" />
        </form>
      </div>
      {sendState?.error && <p className="text-sm text-red-400">{sendState.error}</p>}
      {sendState?.success && <p className="text-sm text-emerald-400">Invited {sendState.invited} players.</p>}
      {cascadeState?.error && <p className="text-sm text-red-400">{cascadeState.error}</p>}
      {cascadeState?.success && (
        <p className="text-sm text-emerald-400">Cascade checked — {cascadeState.invited ?? 0} new invitation(s) sent.</p>
      )}
      {reinviteState?.error && <p className="text-sm text-red-400">{reinviteState.error}</p>}
      {reinviteState?.success && (
        <p className="text-sm text-emerald-400">{reinviteState.invited ?? 0} player(s) invited or re-invited by rank.</p>
      )}
      {resendState?.error && <p className="text-sm text-red-400">{resendState.error}</p>}
      {resendState?.success && <p className="text-sm text-emerald-400">Invitation sent to the selected player.</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Invited</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Registration</th>
              <th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((row) => (
              <tr key={row.id} className="border-b border-slate-900 last:border-0">
                <td className="px-4 py-3 text-slate-400">#{row.rank}</td>
                <td className="px-4 py-3 font-semibold text-white">{row.playerName}</td>
                <td className={`px-4 py-3 font-semibold ${STATUS_STYLE[row.status] ?? 'text-slate-400'}`}>
                  {row.status}
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(row.invitedAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(row.expiresAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-slate-400">
                  {row.paymentStatus ?? (row.status === 'accepted' ? 'unpaid' : '—')}
                  {row.paymentSource === 'manual' && ' · outside payment'}
                </td>
                <td className="px-4 py-3 text-slate-400">{row.registrationStatus ?? 'None'}</td>
                <td className="px-4 py-3">
                  {(row.status === 'pending' || row.status === 'expired') && (
                    <form action={resendAction}>
                      <input type="hidden" name="tournamentId" value={tournamentId} />
                      <input type="hidden" name="playerId" value={row.playerId} />
                      <ActionButton label={row.status === 'expired' || new Date(row.expiresAt) <= new Date() ? 'Revive & resend' : 'Resend'} pendingLabel="Sending…" />
                    </form>
                  )}
                  {row.status === 'accepted' && row.paymentStatus !== 'paid' && <span className="text-xs text-amber-300">Player can pay on dashboard</span>}
                  {canRecordManualPayment({ isAdmin, tournamentStatus, invitationStatus: row.status,
                    paymentStatus: row.paymentStatus, registrationStatus: row.registrationStatus, fee: registrationFee }) && (
                    <ManualPaymentForm tournamentId={tournamentId} playerId={row.playerId}
                      username={row.username} fee={registrationFee} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {invitations.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No invitations sent yet.</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="mb-3 text-sm font-bold text-white">Manually add a player</h3>
        <form action={addAction} className="flex gap-2">
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <input
            name="username"
            placeholder="Username"
            required
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          />
          <ActionButton label="Add" pendingLabel="Adding…" />
        </form>
        {addState?.error && <p className="mt-2 text-sm text-red-400">{addState.error}</p>}
        {addState?.success && <p className="mt-2 text-sm text-emerald-400">Player added.</p>}
      </div>
    </div>
  )
}
