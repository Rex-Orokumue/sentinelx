'use client'
import { useFormState } from 'react-dom'
import { SubmitButton } from '@/components/ui/submit-button'
import type { RegistrationFieldActionState } from '@/lib/games/registration-fields-actions'
import type { RegistrationField } from '@/lib/tournaments/registration-fields'

type Action = (prev: RegistrationFieldActionState, fd: FormData) => Promise<RegistrationFieldActionState>

export function RegistrationFieldForm({
  gameId,
  action,
  existing,
  onDone,
}: {
  gameId: string
  action: Action
  existing?: RegistrationField & { id: string }
  onDone?: () => void
}) {
  const [state, formAction] = useFormState<RegistrationFieldActionState, FormData>(action, undefined)
  if (state?.success) onDone?.()

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      <input type="hidden" name="gameId" value={gameId} />
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input
        name="label"
        placeholder="Label (e.g. Roblox Username)"
        defaultValue={existing?.label}
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <input
        name="placeholder"
        placeholder="Placeholder (optional)"
        defaultValue={existing?.placeholder ?? ''}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <select name="inputType" defaultValue={existing?.inputType ?? 'text'} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white">
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="url">URL</option>
      </select>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="required" value="true" defaultChecked={existing?.required ?? true} />
        Required
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="showOnBracket" value="true" defaultChecked={existing?.showOnBracket ?? false} />
        Show on the public bracket
      </label>
      <details className="text-sm text-slate-400">
        <summary className="cursor-pointer">Advanced: format validation</summary>
        <div className="mt-2 space-y-2">
          <input
            name="validationPattern"
            placeholder="Regex pattern (optional)"
            defaultValue={existing?.validationPattern ?? ''}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
          />
          <input
            name="validationMessage"
            placeholder="Message shown when the pattern fails"
            defaultValue={existing?.validationMessage ?? ''}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
          />
        </div>
      </details>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton pendingLabel="Saving…" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        {existing ? 'Save field' : 'Add field'}
      </SubmitButton>
    </form>
  )
}
