'use client'
import { useFormState } from 'react-dom'
import { SubmitButton } from '@/components/ui/submit-button'

export interface MatchRuleRow {
  id: string
  modeId: string
  name: string
  active: boolean
}

type ActionState = { error?: string; success?: boolean } | undefined
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>

export function MatchRuleForm({
  gameId,
  modeId,
  action,
  existing,
  onDone,
}: {
  gameId: string
  modeId: string
  action: Action
  existing?: MatchRuleRow
  onDone?: () => void
}) {
  const [state, formAction] = useFormState<ActionState, FormData>(action, undefined)
  if (state?.success) onDone?.()

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="modeId" value={modeId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input
        name="name"
        placeholder="Rule name (e.g. Headshot only)"
        defaultValue={existing?.name}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton pendingLabel="Saving…" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {existing ? 'Save match rule' : 'Add match rule'}
      </SubmitButton>
    </form>
  )
}
