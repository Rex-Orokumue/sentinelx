'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { MatchRuleForm, type MatchRuleRow } from './MatchRuleForm'
import { createMatchRule, updateMatchRule, deleteMatchRule, reactivateMatchRule, reorderMatchRules } from '@/lib/games/match-rule-actions'
import type { MatchRuleActionState } from '@/lib/games/match-rule-actions'
import { SubmitButton } from '@/components/ui/submit-button'

function reordered(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function MatchRulesPanel({ gameId, modeId, matchRules }: { gameId: string; modeId: string; matchRules: MatchRuleRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteState, deleteAction] = useFormState<MatchRuleActionState, FormData>(deleteMatchRule, undefined)
  const [reactivateState, reactivateAction] = useFormState<MatchRuleActionState, FormData>(reactivateMatchRule, undefined)
  const [reorderState, reorderAction] = useFormState<MatchRuleActionState, FormData>(reorderMatchRules, undefined)
  const activeRules = matchRules.filter((r) => r.active)
  const inactiveRules = matchRules.filter((r) => !r.active)
  const ids = activeRules.map((r) => r.id)

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-400">Match Rules</h4>

      {activeRules.map((r, i) =>
        editingId === r.id ? (
          <MatchRuleForm key={r.id} gameId={gameId} modeId={modeId} action={updateMatchRule} existing={r} onDone={() => setEditingId(null)} />
        ) : (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-2.5">
            <p className="text-sm font-semibold text-white">{r.name}</p>
            <div className="flex gap-1.5">
              {i > 0 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, -1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↑</SubmitButton>
                </form>
              )}
              {i < activeRules.length - 1 && (
                <form action={reorderAction}>
                  <input type="hidden" name="gameId" value={gameId} />
                  <input type="hidden" name="orderedIds" value={JSON.stringify(reordered(ids, i, 1))} />
                  <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">↓</SubmitButton>
                </form>
              )}
              <button type="button" onClick={() => setEditingId(r.id)} className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">Edit</button>
              <form action={deleteAction}>
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton pendingLabel="…" className="rounded-lg border border-red-900 px-2.5 py-1 text-xs font-bold text-red-400 hover:border-red-700">Remove</SubmitButton>
              </form>
            </div>
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}
      {reorderState?.error && <p className="text-xs text-red-400">{reorderState.error}</p>}

      {adding ? (
        <MatchRuleForm gameId={gameId} modeId={modeId} action={createMatchRule} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">+ Add a match rule</button>
      )}

      {inactiveRules.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Inactive</p>
          {inactiveRules.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-800/60 bg-slate-950/50 p-2.5 opacity-60">
              <p className="text-sm text-slate-400">{r.name}</p>
              <form action={reactivateAction}>
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton pendingLabel="…" className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-bold text-slate-200 hover:border-slate-500">Reactivate</SubmitButton>
              </form>
            </div>
          ))}
          {reactivateState?.error && <p className="text-xs text-red-400">{reactivateState.error}</p>}
        </div>
      )}
    </section>
  )
}
