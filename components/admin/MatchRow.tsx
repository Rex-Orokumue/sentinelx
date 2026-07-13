'use client'
import { useState, type InputHTMLAttributes } from 'react'
import { useFormState } from 'react-dom'
import { updateMatch, toggleMatchLive, type MatchAdminState } from '@/lib/matches/admin-actions'

export interface AdminMatchRow {
  id: string
  playerAName: string
  playerBName: string | null // null => bye
  status: string
  scheduledAt: string // datetime-local value ('' if none)
  isFullDay: boolean
  streamUrl: string
  replayUrl: string
}

export function MatchRow({ match }: { match: AdminMatchRow }) {
  const [saveState, saveAction] = useFormState<MatchAdminState, FormData>(updateMatch, undefined)
  const [liveState, liveAction] = useFormState<MatchAdminState, FormData>(
    toggleMatchLive,
    undefined,
  )
  const [mode, setMode] = useState<'timed' | 'full_day'>(match.isFullDay ? 'full_day' : 'timed')

  if (match.status === 'bye' || match.playerBName === null) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="font-bold text-white">{match.playerAName}</p>
        <p className="mt-0.5 text-xs text-slate-500">Bye — auto-advances</p>
      </div>
    )
  }

  const canToggle = match.status === 'scheduled' || match.status === 'live'
  const err = saveState?.error || liveState?.error

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-bold text-white">
          {match.playerAName} <span className="text-slate-500">vs</span> {match.playerBName}
        </p>
        <span className="shrink-0 text-xs font-semibold text-slate-400">{match.status}</span>
      </div>

      <form action={saveAction} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="id" value={match.id} />
        <div className="flex items-center gap-3 text-xs sm:col-span-3">
          <label className="flex items-center gap-1.5 text-slate-400">
            <input
              type="radio"
              name="schedulingMode"
              value="timed"
              checked={mode === 'timed'}
              onChange={() => setMode('timed')}
            />
            Timed
          </label>
          <label className="flex items-center gap-1.5 text-slate-400">
            <input
              type="radio"
              name="schedulingMode"
              value="full_day"
              checked={mode === 'full_day'}
              onChange={() => setMode('full_day')}
            />
            Full day
          </label>
        </div>
        {mode === 'timed' ? (
          <Field label="Schedule" name="scheduledAt" type="datetime-local" defaultValue={match.scheduledAt} />
        ) : (
          <Field label="Date" name="scheduledDate" type="date" defaultValue={match.scheduledAt.slice(0, 10)} />
        )}
        <Field label="Stream URL" name="streamUrl" type="url" defaultValue={match.streamUrl} placeholder="YouTube link" />
        <Field label="Replay URL" name="replayUrl" type="url" defaultValue={match.replayUrl} placeholder="YouTube link" />
        <div className="flex items-center gap-2 sm:col-span-3">
          <button
            type="submit"
            className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
          >
            Save
          </button>
          {saveState?.success && <span className="text-xs text-emerald-400">Saved.</span>}
        </div>
      </form>

      {canToggle && (
        <form action={liveAction} className="mt-2">
          <input type="hidden" name="id" value={match.id} />
          <button
            type="submit"
            className={`rounded-lg px-4 py-2 text-xs font-bold ${
              match.status === 'live'
                ? 'border border-slate-700 text-slate-200 hover:border-slate-500'
                : 'bg-red-600 text-white hover:bg-red-500'
            }`}
          >
            {match.status === 'live' ? 'End live' : 'Go live'}
          </button>
        </form>
      )}

      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  ...rest
}: { label: string; name: string; type?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-xs font-medium text-slate-400">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        {...rest}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
