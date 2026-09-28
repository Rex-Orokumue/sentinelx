'use client'
import { useFormState } from 'react-dom'
import { SubmitButton } from '@/components/ui/submit-button'

export interface ModeRow {
  id: string
  name: string
  competitionFormat: string
  active: boolean
}

type ActionState = { error?: string; success?: boolean } | undefined
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>

export function ModeForm({
  gameId,
  action,
  existing,
  onDone,
}: {
  gameId: string
  action: Action
  existing?: ModeRow
  onDone?: () => void
}) {
  const [state, formAction] = useFormState<ActionState, FormData>(action, undefined)
  if (state?.success) onDone?.()

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      <input type="hidden" name="gameId" value={gameId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input
        name="name"
        placeholder="Name (e.g. Clash Squad)"
        defaultValue={existing?.name}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <select name="competitionFormat" defaultValue={existing?.competitionFormat ?? 'head_to_head'} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
        <option value="head_to_head">Head-to-head</option>
        <option value="points_race">Points race</option>
      </select>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton pendingLabel="Saving…" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {existing ? 'Save mode' : 'Add mode'}
      </SubmitButton>
    </form>
  )
}
