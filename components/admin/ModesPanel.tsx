'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { ModeForm, type ModeRow } from './ModeForm'
import { FormatsPanel } from './FormatsPanel'
import type { FormatRow } from './FormatForm'
import { MapsPanel } from './MapsPanel'
import type { MapRow } from './MapForm'
import { MatchRulesPanel } from './MatchRulesPanel'
import type { MatchRuleRow } from './MatchRuleForm'
import { createMode, updateMode, deleteMode, reactivateMode, reorderModes } from '@/lib/games/mode-actions'
import type { ModeActionState } from '@/lib/games/mode-actions'
import { SubmitButton } from '@/components/ui/submit-button'

function reordered(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function ModesPanel({
  gameId,
  modes,
  formats,
  maps,
  matchRules,
}: {
  gameId: string
  modes: ModeRow[]
  formats: FormatRow[]
  maps: MapRow[]
  matchRules: MatchRuleRow[]
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteState, deleteAction] = useFormState<ModeActionState, FormData>(deleteMode, undefined)
  const [reactivateState, reactivateAction] = useFormState<ModeActionState, FormData>(reactivateMode, undefined)
  const [reorderState, reorderAction] = useFormState<ModeActionState, FormData>(reorderModes, undefined)
  const activeModes = modes.filter((m) => m.active)
  const inactiveModes = modes.filter((m) => !m.active)
  const ids = activeModes.map((m) => m.id)

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold text-white">Modes</h3>
      <p className="text-xs text-slate-500">What is actually being played — Battle Royale, Clash Squad. Expand a mode to manage its Formats, Maps and Match Rules.</p>

      {activeModes.map((m, i) =>
        editingId === m.id ? (
          <ModeForm key={m.id} gameId={gameId} action={updateMode} existing={m} onDone={() => setEditingId(null)} />
        ) : (
          <div key={m.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => setExpandedId(expandedId === m.id ? null : m.id)} className="text-left">
                <p className="text-sm font-semibold text-white">
                  {expandedId === m.id ? '▾' : '▸'} {m.name} <span className="text-slate-500">({m.competitionFormat})</span>
                </p>
              </button>
              <div className="flex shrink-0 gap-1.5">
                {i > 0 && (
                  <form action={reorderAction}>
                    <input type="hidden" name="gameId" value={gameId} />
                    <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, -1))} />
                    <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">↑</SubmitButton>
                  </form>
                )}
                {i < activeModes.length - 1 && (
                  <form action={reorderAction}>
                    <input type="hidden" name="gameId" value={gameId} />
                    <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, 1))} />
                    <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">↓</SubmitButton>
                  </form>
                )}
                <button type="button" onClick={() => setEditingId(m.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">Edit</button>
                <form action={deleteAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="id" value={m.id} />
                  <SubmitButton pendingLabel="Removing…" className="rounded-lg border border-red-900 px-3 py-1.5 text-xs font-bold text-red-400 hover:border-red-700">Remove</SubmitButton>
                </form>
              </div>
            </div>
            {expandedId === m.id && (
              <div className="mt-3 space-y-4 border-t border-slate-800 pt-3">
                <FormatsPanel gameId={gameId} modeId={m.id} formats={formats.filter((f) => f.modeId === m.id)} />
                <MapsPanel gameId={gameId} modeId={m.id} maps={maps.filter((mm) => mm.modeId === m.id)} />
                <MatchRulesPanel gameId={gameId} modeId={m.id} matchRules={matchRules.filter((r) => r.modeId === m.id)} />
              </div>
            )}
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}
      {reorderState?.error && <p className="text-xs text-red-400">{reorderState.error}</p>}

      {adding ? (
        <ModeForm gameId={gameId} action={createMode} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-500">+ Add a mode</button>
      )}

      {inactiveModes.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Inactive</p>
          {inactiveModes.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-xl border border-slate-800/60 bg-slate-900/50 p-3 opacity-60">
              <p className="text-sm text-slate-400">{m.name} <span className="text-slate-600">({m.competitionFormat})</span></p>
              <form action={reactivateAction}>
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={m.id} />
                <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">Reactivate</SubmitButton>
              </form>
            </div>
          ))}
          {reactivateState?.error && <p className="text-xs text-red-400">{reactivateState.error}</p>}
        </div>
      )}
    </section>
  )
}
