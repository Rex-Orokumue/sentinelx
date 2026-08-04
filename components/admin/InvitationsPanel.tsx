'use client'
import { useFormState, useFormStatus } from 'react-dom'
import {
  sendInvitations,
  triggerCascadeNow,
  manuallyAddInvitee,
  type InvitationActionState,
} from '@/lib/seasons/invitation-actions'

interface InvitationRow {
  id: string
  playerName: string
  rank: number
  status: string
  invitedAt: string
  expiresAt: string
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

export function InvitationsPanel({ tournamentId, invitations }: { tournamentId: string; invitations: InvitationRow[] }) {
  const [sendState, sendAction] = useFormState<InvitationActionState, FormData>(sendInvitations, undefined)
  const [cascadeState, cascadeAction] = useFormState<InvitationActionState, FormData>(triggerCascadeNow, undefined)
  const [addState, addAction] = useFormState<InvitationActionState, FormData>(manuallyAddInvitee, undefined)

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
      </div>
      {sendState?.error && <p className="text-sm text-red-400">{sendState.error}</p>}
      {sendState?.success && <p className="text-sm text-emerald-400">Invited {sendState.invited} players.</p>}
      {cascadeState?.error && <p className="text-sm text-red-400">{cascadeState.error}</p>}
      {cascadeState?.success && <p className="text-sm text-emerald-400">Cascade checked.</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Invited</th>
              <th className="px-4 py-3">Expires</th>
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
