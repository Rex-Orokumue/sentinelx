'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { FormatForm, type FormatRow } from './FormatForm'
import { createFormat, updateFormat, deleteFormat, reorderFormats } from '@/lib/games/format-actions'
import type { FormatActionState } from '@/lib/games/format-actions'
import { SubmitButton } from '@/components/ui/submit-button'

function reordered(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function FormatsPanel({ gameId, modeId, formats }: { gameId: string; modeId: string; formats: FormatRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteState, deleteAction] = useFormState<FormatActionState, FormData>(deleteFormat, undefined)
  const [reorderState, reorderAction] = useFormState<FormatActionState, FormData>(reorderFormats, undefined)
  const ids = formats.map((f) => f.id)

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Formats</h4>

      {formats.map((f, i) =>
        editingId === f.id ? (
          <FormatForm key={f.id} gameId={gameId} modeId={modeId} action={updateFormat} existing={f} onDone={() => setEditingId(null)} />
        ) : (
          <div key={f.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-2.5">
            <div>
              <p className="text-sm font-semibold text-white">{f.name}</p>
              <p className="text-xs text-slate-500">
                {f.entryUnit === 'squad' ? `Squad · ${f.teamSize}` : 'Solo'} · {f.available ? 'Available' : 'Coming soon'}
              </p>
            </div>
            <div className="flex gap-1.5">
              {i > 0 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, -1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↑</SubmitButton>
                </form>
              )}
              {i < formats.length - 1 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, 1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↓</SubmitButton>
                </form>
              )}
              <button type="button" onClick={() => setEditingId(f.id)} className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">Edit</button>
              <form action={deleteAction}>
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={f.id} />
                <SubmitButton pendingLabel="…" className="rounded-lg border border-red-900 px-2.5 py-1 text-xs font-bold text-red-400 hover:border-red-700">Remove</SubmitButton>
              </form>
            </div>
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}
      {reorderState?.error && <p className="text-xs text-red-400">{reorderState.error}</p>}

      {adding ? (
        <FormatForm gameId={gameId} modeId={modeId} action={createFormat} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">+ Add a format</button>
      )}
    </section>
  )
}
