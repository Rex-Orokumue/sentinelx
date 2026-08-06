'use client'
import { useState } from 'react'
import { recomputeAllAction } from '@/lib/scoring/admin-actions'

type Status = 'idle' | 'confirming' | 'loading' | 'done' | 'error'

export function RecomputeButton() {
  const [status, setStatus] = useState<Status>('idle')
  const [players, setPlayers] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleRecompute() {
    setStatus('loading')
    setErrorMsg(null)
    try {
      const fd = new FormData()
      const result = await recomputeAllAction(undefined, fd)
      if (result?.error) {
        setErrorMsg(result.error)
        setStatus('error')
      } else if (result?.players != null) {
        setPlayers(result.players)
        setStatus('done')
      } else {
        // undefined result usually means redirect() was called inside the action
        // (e.g. not an admin), which Next.js surfaces as a navigation, not a return.
        setErrorMsg('Action did not return a result — make sure you are logged in as an admin.')
        setStatus('error')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErrorMsg(`Unexpected error: ${msg}`)
      setStatus('error')
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="font-bold text-white">Recompute all scores &amp; stats</p>
      <p className="mt-0.5 text-xs text-slate-500">
        Rebuilds every player&apos;s aggregates and Sentinel Score from match history and the
        events log. Safe to run anytime; use it to recover from a scoring bug.
      </p>

      <div className="mt-3">
        {status === 'idle' && (
          <button
            type="button"
            onClick={() => setStatus('confirming')}
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-500"
          >
            Recompute all…
          </button>
        )}

        {status === 'confirming' && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-amber-400">
              This recomputes scores for all players. Are you sure?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRecompute}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500"
              >
                Yes, recompute all players
              </button>
              <button
                type="button"
                onClick={() => setStatus('idle')}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:border-slate-500"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === 'loading' && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <svg className="h-4 w-4 animate-spin text-violet-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Recomputing… this may take up to a minute</span>
          </div>
        )}

        {status === 'done' && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-emerald-400">
              ✓ Successfully recomputed {players} player{players === 1 ? '' : 's'}.
            </p>
            <button
              type="button"
              onClick={() => { setStatus('idle'); setPlayers(null) }}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:border-slate-500"
            >
              Run again
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-red-400">✗ {errorMsg}</p>
            <button
              type="button"
              onClick={() => setStatus('idle')}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:border-slate-500"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
