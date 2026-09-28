'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { MapForm, type MapRow } from './MapForm'
import { createMap, updateMap, deleteMap, reorderMaps } from '@/lib/games/map-actions'
import type { MapActionState } from '@/lib/games/map-actions'
import { SubmitButton } from '@/components/ui/submit-button'

function reordered(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function MapsPanel({ gameId, modeId, maps }: { gameId: string; modeId: string; maps: MapRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteState, deleteAction] = useFormState<MapActionState, FormData>(deleteMap, undefined)
  const [reorderState, reorderAction] = useFormState<MapActionState, FormData>(reorderMaps, undefined)
  const ids = maps.map((m) => m.id)

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Maps</h4>

      {maps.map((m, i) =>
        editingId === m.id ? (
          <MapForm key={m.id} gameId={gameId} modeId={modeId} action={updateMap} existing={m} onDone={() => setEditingId(null)} />
        ) : (
          <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-2.5">
            <p className="text-sm font-semibold text-white">{m.name}</p>
            <div className="flex gap-1.5">
              {i > 0 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, -1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↑</SubmitButton>
                </form>
              )}
              {i < maps.length - 1 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, 1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↓</SubmitButton>
                </form>
              )}
              <button type="button" onClick={() => setEditingId(m.id)} className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">Edit</button>
              <form action={deleteAction}>
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={m.id} />
                <SubmitButton pendingLabel="…" className="rounded-lg border border-red-900 px-2.5 py-1 text-xs font-bold text-red-400 hover:border-red-700">Remove</SubmitButton>
              </form>
            </div>
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}
      {reorderState?.error && <p className="text-xs text-red-400">{reorderState.error}</p>}

      {adding ? (
        <MapForm gameId={gameId} modeId={modeId} action={createMap} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">+ Add a map</button>
      )}
    </section>
  )
}
