'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { RegistrationFieldForm } from './RegistrationFieldForm'
import { createRegistrationField, updateRegistrationField, deleteRegistrationField } from '@/lib/games/registration-fields-actions'
import type { RegistrationFieldActionState } from '@/lib/games/registration-fields-actions'
import type { RegistrationField } from '@/lib/tournaments/registration-fields'
import { SubmitButton } from '@/components/ui/submit-button'

type FieldRow = RegistrationField & { id: string }

export function RegistrationFieldsPanel({ gameId, fields }: { gameId: string; fields: FieldRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deleteState, deleteAction] = useFormState<RegistrationFieldActionState, FormData>(deleteRegistrationField, undefined)

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold text-white">Registration Fields</h3>
      <p className="text-xs text-slate-500">
        What the registration form asks a player for. Preview: {fields.length === 0 ? 'displayName and WhatsApp only.' : fields.map((f) => f.label).join(', ')}.
      </p>

      {fields.map((f) =>
        editingId === f.id ? (
          <RegistrationFieldForm key={f.id} gameId={gameId} action={updateRegistrationField} existing={f} onDone={() => setEditingId(null)} />
        ) : (
          <div key={f.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-3">
            <div>
              <p className="text-sm font-semibold text-white">{f.label} <span className="text-slate-500">({f.fieldKey})</span></p>
              <p className="text-xs text-slate-500">{f.required ? 'Required' : 'Optional'}{f.showOnBracket ? ' · shown on bracket' : ''}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditingId(f.id)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">
                Edit
              </button>
              <form action={deleteAction}>
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="id" value={f.id} />
                <SubmitButton pendingLabel="Removing…" className="rounded-lg border border-red-900 px-3 py-1.5 text-xs font-bold text-red-400 hover:border-red-700">
                  Remove
                </SubmitButton>
              </form>
            </div>
          </div>
        ),
      )}
      {deleteState?.error && <p className="text-xs text-red-400">{deleteState.error}</p>}

      {adding ? (
        <RegistrationFieldForm gameId={gameId} action={createRegistrationField} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-bold text-slate-200 hover:border-slate-500">
          + Add a field
        </button>
      )}
    </section>
  )
}
