'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { confirmLobby, type LobbyResultState } from '@/lib/tournaments/lobby-result-actions'
import type { LobbyGridRow } from '@/lib/tournaments/lobby-grid'
import type { LobbyFlag } from '@/lib/tournaments/lobby-validation'

export function LobbyResultGrid({
  lobbyId,
  rows,
  flags,
  locked,
}: {
  lobbyId: string
  rows: LobbyGridRow[]
  flags: LobbyFlag[]
  locked: boolean
}) {
  const [state, formAction] = useFormState<LobbyResultState, FormData>(confirmLobby, undefined)

  // missing_submission is surfaced as a warning, not a blocker: the admin is
  // expected to fill those rows in, and confirmLobby refuses on blanks anyway
  // with a message that says what to enter.
  const blocking = flags.filter((f) => f.code !== 'missing_submission')
  const missing = flags.find((f) => f.code === 'missing_submission')

  if (locked) {
    return (
      <div className="space-y-3">
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          Confirmed. These points are frozen — editing the stage&apos;s points table will not change
          them.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-slate-500">
                <th className="pb-2">Entrant</th>
                <th className="pb-2">Place</th>
                <th className="pb-2">Kills</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.entrantId} className="border-t border-slate-800">
                  <td className="py-2 font-semibold text-white">{row.displayName}</td>
                  <td className="py-2 text-slate-300">{row.placement ?? '—'}</td>
                  <td className="py-2 text-slate-300">{row.kills ?? '—'}</td>
                  <td className="py-2 text-xs text-slate-400">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="lobbyId" value={lobbyId} />

      {blocking.map((f, i) => (
        <p
          key={`b${i}`}
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          {f.message}
        </p>
      ))}
      {missing && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {missing.message} Fill their rows in before confirming — for someone who never played,
          record their last placement and 0 kills.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-slate-500">
              <th className="pb-2">Entrant</th>
              <th className="pb-2 w-24">Place</th>
              <th className="pb-2 w-24">Kills</th>
              <th className="pb-2">Proof</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.entrantId} className="border-t border-slate-800">
                <td className="py-2 pr-3">
                  <span className="font-semibold text-white">{row.displayName}</span>
                  {!row.submitted && (
                    <span className="ml-2 text-[11px] text-amber-400">no submission</span>
                  )}
                  {row.status === 'disputed' && (
                    <span className="ml-2 text-[11px] text-red-400">disputed</span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  <input
                    name={`placement_${row.entrantId}`}
                    type="number"
                    min={1}
                    defaultValue={row.placement ?? ''}
                    className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white focus:border-violet-500 focus:outline-none"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    name={`kills_${row.entrantId}`}
                    type="number"
                    min={0}
                    defaultValue={row.kills ?? ''}
                    className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white focus:border-violet-500 focus:outline-none"
                  />
                </td>
                <td className="py-2 text-xs">
                  {row.screenshotUrl ? (
                    <a
                      href={row.screenshotUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-violet-400 hover:text-violet-300"
                    >
                      Screenshot
                    </a>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      {state?.success && <p className="text-xs text-emerald-400">Lobby confirmed.</p>}
      <ConfirmButton blocked={blocking.length > 0} />
    </form>
  )
}

function ConfirmButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus()
  return (
    <div>
      <button
        type="submit"
        disabled={blocked || pending}
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
      >
        {pending ? 'Confirming…' : 'Confirm lobby'}
      </button>
      {blocked && (
        <p className="mt-2 text-xs text-slate-500">
          Fix the problems above to enable confirmation.
        </p>
      )}
    </div>
  )
}
