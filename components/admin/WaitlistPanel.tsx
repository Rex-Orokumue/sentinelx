'use client'
import { useFormState } from 'react-dom'
import { formatDateTime } from '@/lib/format'
import type { AdminRegistrationRow } from './RegistrationsTable'
import { removeFromWaitlist, promoteFromWaitlist, type DisqualifyState } from '@/lib/tournaments/registrations-admin-actions'

function WaitlistRemoveButton({ registrationId, tournamentId }: { registrationId: string; tournamentId: string }) {
  const [state, action] = useFormState<DisqualifyState, FormData>(removeFromWaitlist, undefined)

  if (state?.success) return <span className="text-xs text-slate-500">Removed</span>

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('Remove this player from the waitlist?')) {
          e.preventDefault()
        }
      }}
    >
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <button
        type="submit"
        className="rounded-lg border border-red-500/40 px-2 py-0.5 text-xs font-bold text-red-400 hover:bg-red-500/10"
      >
        ✕
      </button>
      {state?.error && <p className="mt-1 text-xs text-red-400">{state.error}</p>}
    </form>
  )
}

function WaitlistPromoteButton({
  registrationId,
  tournamentId,
  playerId,
  tournamentTitle,
}: {
  registrationId: string
  tournamentId: string
  playerId: string
  tournamentTitle: string
}) {
  const [state, action] = useFormState<DisqualifyState, FormData>(promoteFromWaitlist, undefined)

  if (state?.success) return <span className="text-xs font-bold text-emerald-400">Added ✓</span>

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm('Add this player to the tournament? They will be marked as paid (fee waived).')) {
          e.preventDefault()
        }
      }}
    >
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input type="hidden" name="playerId" value={playerId} />
      <input type="hidden" name="tournamentTitle" value={tournamentTitle} />
      <button
        type="submit"
        className="rounded-lg border border-emerald-500/40 px-2.5 py-0.5 text-xs font-bold text-emerald-400 hover:bg-emerald-500/10"
      >
        Add
      </button>
      {state?.error && <p className="mt-1 text-xs text-red-400">{state.error}</p>}
    </form>
  )
}

// Waitlisted players get their own section rather than being mixed into the
// main registrations table — admin needs to find them at a glance (and their
// WhatsApp number) the moment a slot opens up.
export function WaitlistPanel({
  rows,
  tournamentId,
  tournamentTitle,
}: {
  rows: AdminRegistrationRow[]
  tournamentId: string
  tournamentTitle: string
}) {
  if (rows.length === 0) return null

  return (
    <div className="mb-6">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-amber-400">
        Waitlist ({rows.length})
      </h3>
      <p className="mb-3 text-xs text-slate-500">
        Available as substitutes. Use &quot;Add substitute&quot; on a disqualified row to bring one in — their
        username autocompletes there.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-amber-500/30 bg-amber-500/[0.04]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-amber-500/20 text-[11px] uppercase tracking-widest text-slate-500">
              <th className="px-3 py-2.5 text-left">Player</th>
              <th className="px-2 py-2.5 text-left">Username</th>
              <th className="px-2 py-2.5 text-left">WhatsApp</th>
              <th className="px-2 py-2.5 text-left">Club</th>
              <th className="px-3 py-2.5 text-left">Joined</th>
              <th className="w-24 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-amber-500/10 last:border-0">
                <td className="px-3 py-2.5 font-semibold text-white">
                  {r.regDisplayName ?? r.username ?? 'Unknown'}
                </td>
                <td className="px-2 py-2.5 text-slate-400">{r.username ?? '—'}</td>
                <td className="px-2 py-2.5 text-slate-300">{r.regWhatsapp ?? '—'}</td>
                <td className="px-2 py-2.5 text-slate-300">{r.regClubName ?? '—'}</td>
                <td className="px-3 py-2.5 text-slate-400">{formatDateTime(r.registeredAt)}</td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <WaitlistPromoteButton
                      registrationId={r.id}
                      tournamentId={tournamentId}
                      playerId={r.playerId}
                      tournamentTitle={tournamentTitle}
                    />
                    <WaitlistRemoveButton registrationId={r.id} tournamentId={tournamentId} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
