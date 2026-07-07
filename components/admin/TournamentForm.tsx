'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { type TournamentFormState } from '@/lib/tournaments/admin-actions'

export interface TournamentFormValues {
  id?: string
  title: string
  slug: string
  gameId: string
  description: string
  bannerUrl: string
  registrationFee: string
  prizePool: string
  maxPlayers: string
  registrationStart: string
  registrationEnd: string
  tournamentStart: string
  tournamentEnd: string
}

type Action = (prev: TournamentFormState, fd: FormData) => Promise<TournamentFormState>

export function TournamentForm({
  action,
  games,
  initial,
  slugLocked,
  submitLabel,
}: {
  action: Action
  games: { id: string; name: string }[]
  initial: TournamentFormValues
  slugLocked: boolean
  submitLabel: string
}) {
  const [state, formAction] = useFormState<TournamentFormState, FormData>(action, undefined)
  return (
    <form action={formAction} className="space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <Field label="Title" name="title" defaultValue={initial.title} required />

      <div className="space-y-1.5">
        <label htmlFor="slug" className="text-sm font-medium text-slate-300">
          URL slug {slugLocked && <span className="text-slate-500">— locked</span>}
        </label>
        <input
          id="slug"
          name="slug"
          defaultValue={initial.slug}
          readOnly={slugLocked}
          placeholder="auto-generated from title if left blank"
          className={`w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none ${
            slugLocked ? 'bg-slate-800 text-slate-400' : 'bg-slate-950'
          }`}
        />
        {slugLocked && (
          <p className="text-xs text-slate-500">Locked — changing would break public URLs.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="gameId" className="text-sm font-medium text-slate-300">
          Game
        </label>
        <select
          id="gameId"
          name="gameId"
          defaultValue={initial.gameId}
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="" disabled>
            Choose a game
          </option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="text-sm font-medium text-slate-300">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          defaultValue={initial.description}
          rows={3}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        />
      </div>

      <Field label="Banner URL" name="bannerUrl" type="url" defaultValue={initial.bannerUrl} />

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Registration fee (₦)"
          name="registrationFee"
          type="number"
          defaultValue={initial.registrationFee}
        />
        <Field
          label="Prize pool (₦)"
          name="prizePool"
          type="number"
          defaultValue={initial.prizePool}
        />
      </div>

      <Field
        label="Max players (2–64)"
        name="maxPlayers"
        type="number"
        defaultValue={initial.maxPlayers}
      />

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Registration start"
          name="registrationStart"
          type="datetime-local"
          defaultValue={initial.registrationStart}
        />
        <Field
          label="Registration end"
          name="registrationEnd"
          type="datetime-local"
          defaultValue={initial.registrationEnd}
        />
        <Field
          label="Tournament start"
          name="tournamentStart"
          type="datetime-local"
          defaultValue={initial.tournamentStart}
        />
        <Field
          label="Tournament end"
          name="tournamentEnd"
          type="datetime-local"
          defaultValue={initial.tournamentEnd}
        />
      </div>

      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-400">Saved.</p>}
      <SubmitButton label={submitLabel} />
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium text-slate-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Saving…' : label}
    </button>
  )
}
