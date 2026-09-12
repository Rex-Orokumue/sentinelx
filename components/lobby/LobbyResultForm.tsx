'use client'
import { useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { useFormState } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import {
  submitLobbyResult,
  disputeLobbyResult,
  type LobbyResultState,
} from '@/lib/tournaments/lobby-result-actions'

export function LobbyResultForm({
  lobbyId,
  entrantCount,
  confirmed,
  initial,
}: {
  lobbyId: string
  entrantCount: number
  confirmed: boolean
  initial: {
    placement: number | null
    kills: number | null
    hasScreenshot: boolean
    totalPoints: number | null
    status: string
  } | null
}) {
  const [state, formAction] = useFormState<LobbyResultState, FormData>(submitLobbyResult, undefined)
  const [uploading, setUploading] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Once the admin has confirmed, the result is the record. The only thing left
  // a player can do is say it is wrong.
  if (confirmed) {
    return <ConfirmedResult lobbyId={lobbyId} initial={initial} />
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setClientError(null)
    const fd = new FormData(e.currentTarget)
    const file = fd.get('screenshot') as File | null
    fd.delete('screenshot')

    const hasNewFile = file && file.size > 0
    if (!hasNewFile && !initial?.hasScreenshot) {
      setClientError('A screenshot is required.')
      return
    }

    if (hasNewFile) {
      setUploading(true)
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setUploading(false)
        setClientError('Please log in.')
        return
      }
      const safeName = file!.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${user.id}/${lobbyId}/${Date.now()}-${safeName}`
      const { error } = await supabase.storage.from('match-evidence').upload(path, file!, { upsert: false })
      setUploading(false)
      if (error) {
        setClientError('Screenshot upload failed. Please try again.')
        return
      }
      fd.set('screenshotPath', path)
    } else {
      fd.set('screenshotPath', '')
    }

    fd.set('lobbyId', lobbyId)
    startTransition(() => formAction(fd))
  }

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center text-sm font-semibold text-emerald-400">
        ✓ Result submitted — awaiting admin review. You can edit it here until the lobby is
        confirmed.
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-base font-bold text-white">Submit your result</h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="placement" className="text-sm font-medium text-slate-300">
            Your placement
          </label>
          <input
            id="placement"
            name="placement"
            type="number"
            min={1}
            max={entrantCount || 100}
            defaultValue={initial?.placement ?? undefined}
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          />
          <p className="text-xs text-slate-500">1 = Booyah</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="kills" className="text-sm font-medium text-slate-300">
            Your kills
          </label>
          <input
            id="kills"
            name="kills"
            type="number"
            min={0}
            defaultValue={initial?.kills ?? undefined}
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="screenshot" className="text-sm font-medium text-slate-300">
          Result screenshot {initial?.hasScreenshot && <span className="text-slate-500">— one already uploaded</span>}
        </label>
        <input
          id="screenshot"
          name="screenshot"
          type="file"
          accept="image/*"
          className="w-full text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:text-white"
        />
      </div>

      {clientError && <p className="text-sm text-red-400">{clientError}</p>}
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}

      <button
        type="submit"
        disabled={uploading}
        className="w-full rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
      >
        {uploading ? 'Uploading…' : 'Submit result'}
      </button>
    </form>
  )
}

function ConfirmedResult({
  lobbyId,
  initial,
}: {
  lobbyId: string
  initial: {
    placement: number | null
    kills: number | null
    totalPoints: number | null
    status: string
  } | null
}) {
  const [state, formAction] = useFormState<LobbyResultState, FormData>(disputeLobbyResult, undefined)
  const disputed = initial?.status === 'disputed' || state?.success

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-base font-bold text-white">Your result</h2>
      <div className="flex items-baseline gap-4">
        <Stat label="Placement" value={initial?.placement ?? '—'} />
        <Stat label="Kills" value={initial?.kills ?? '—'} />
        <Stat label="Points" value={initial?.totalPoints ?? '—'} />
      </div>

      {disputed ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          You have raised a dispute. An admin will review it.
        </p>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="lobbyId" value={lobbyId} />
          {state?.error && <p className="mb-2 text-xs text-red-400">{state.error}</p>}
          <button type="submit" className="text-xs font-semibold text-red-400 hover:text-red-300">
            Something wrong? Raise a dispute
          </button>
        </form>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className="font-display text-2xl font-black text-white">{value}</p>
    </div>
  )
}
