'use client'
import { useFormState } from 'react-dom'
import { SubmitButton } from '@/components/ui/submit-button'

export interface MatchTypeRow {
  id: string
  name: string
  available: boolean
}

type ActionState = { error?: string; success?: boolean } | undefined
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>

export function MatchTypeForm({
  action,
  existing,
  onDone,
}: {
  action: Action
  existing?: MatchTypeRow
  onDone?: () => void
}) {
  const [state, formAction] = useFormState<ActionState, FormData>(action, undefined)
  if (state?.success) onDone?.()

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input
        name="name"
        placeholder="Name (e.g. Best of 7)"
        defaultValue={existing?.name}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="available" value="true" defaultChecked={existing?.available ?? false} />
        Available (uncheck to show as &quot;coming soon&quot;)
      </label>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton pendingLabel="Saving…" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {existing ? 'Save match type' : 'Add match type'}
      </SubmitButton>
    </form>
  )
}
