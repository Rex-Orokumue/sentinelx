'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { MatchTypeForm, type MatchTypeRow } from './MatchTypeForm'
import { createMatchType, updateMatchType, deleteMatchType, reorderMatchTypes } from '@/lib/games/match-type-actions'
import type { MatchTypeActionState } from '@/lib/games/match-type-actions'
import { SubmitButton } from '@/components/ui/submit-button'

function reordered(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function MatchTypesPanel({ matchTypes }: { matchTypes: MatchTypeRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteState, deleteAction] = useFormState<MatchTypeActionState, FormData>(deleteMatchType, undefined)
  const [reorderState, reorderAction] = useFormState<MatchTypeActionState, FormData>(reorderMatchTypes, undefined)
  const ids = matchTypes.map((t) => t.id)

  return (
    <section className="mt-8 space-y-3">
      <h3 className="text-sm font-bold text-white">Match Types</h3>
      <p className="text-xs text-slate-500">Series length for head-to-head tournaments — global, not tied to any one game.</p>

      {matchTypes.map((t, i) =>
        editingId === t.id ? (
          <MatchTypeForm key={t.id} action={updateMatchType} existing={t} onDone={() => setEditingId(null)} />
        ) : (
          <div key={t.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-3">
            <div>
              <p className="text-sm font-semibold text-white">{t.name}</p>
              <p className="text-xs text-slate-500">{t.available ? 'Available' : 'Coming soon'}</p>
            </div>
            <div className="flex gap-2">
              {i > 0 && (
                <form action={reorderAction}>
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, -1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">↑</SubmitButton>
                </form>
              )}
              {i < matchTypes.length - 1 && (
                <form action={reorderAction}>
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, 1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">↓</SubmitButton>
                </form>
              )}
              <button type="button" onClick={() => setEditingId(t.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">Edit</button>
              <form action={deleteAction}>
                <input type="hidden" name="id" value={t.id} />
                <SubmitButton pendingLabel="Removing…" className="rounded-lg border border-red-900 px-3 py-1.5 text-xs font-bold text-red-400 hover:border-red-700">Remove</SubmitButton>
              </form>
            </div>
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}
      {reorderState?.error && <p className="text-xs text-red-400">{reorderState.error}</p>}

      {adding ? (
        <MatchTypeForm action={createMatchType} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-500">+ Add a match type</button>
      )}
    </section>
  )
}
