'use client'
import { useState, type InputHTMLAttributes } from 'react'
import { useFormState } from 'react-dom'
import { updateMatch, toggleMatchLive, type MatchAdminState } from '@/lib/matches/admin-actions'

export interface AdminMatchRow {
  id: string
  playerAName: string
  playerBName: string | null // null => bye
  // Pre-built wa.me links (see lib/matches/admin-whatsapp.ts). Null => that
  // player has no reachable number. Built server-side so no phone number ever
  // reaches the client for a player admin can't message anyway.
  playerAWhatsAppUrl: string | null
  playerBWhatsAppUrl: string | null
  status: string
  scheduledAt: string // datetime-local value ('' if none)
  isFullDay: boolean
  streamUrl: string
  replayUrl: string
}

// Tapping this opens WhatsApp with a message about this exact fixture already
// typed — admin no longer has to hunt for whose number is whose.
function WhatsAppChip({ name, url }: { name: string; url: string | null }) {
  if (!url) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-600">
        {name} · no WhatsApp
      </span>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#25D366]/30 px-2.5 py-1.5 text-xs font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.17c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.09-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.42h-.48c-.16 0-.43.06-.65.31-.22.25-.85.84-.85 2.05s.87 2.38.99 2.54c.12.17 1.71 2.61 4.15 3.66.58.25 1.03.4 1.39.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29Z" />
      </svg>
      {name}
    </a>
  )
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
        <div className="mt-2.5">
          <WhatsAppChip name={match.playerAName} url={match.playerAWhatsAppUrl} />
        </div>
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

      <div className="mb-3 flex flex-wrap gap-2">
        <WhatsAppChip name={match.playerAName} url={match.playerAWhatsAppUrl} />
        <WhatsAppChip name={match.playerBName} url={match.playerBWhatsAppUrl} />
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
