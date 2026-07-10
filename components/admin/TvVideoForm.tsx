'use client'
import { useFormState } from 'react-dom'
import { addVideo, updateVideo, type TvVideoState } from '@/lib/tv/admin-actions'
import { TV_CATEGORIES, CATEGORY_LABELS } from '@/lib/tv/schema'

export interface TvVideoDefaults {
  id?: string
  title?: string
  category?: string
  youtubeUrl?: string
  description?: string
  thumbnailUrl?: string
}

export function TvVideoForm({ defaults, onDone }: { defaults?: TvVideoDefaults; onDone?: () => void }) {
  const editing = Boolean(defaults?.id)
  const action = editing ? updateVideo : addVideo
  const [state, formAction] = useFormState<TvVideoState, FormData>(action, undefined)
  if (state?.success && onDone) onDone()

  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      {editing && <input type="hidden" name="id" value={defaults!.id} />}
      <Field label="Title" name="title" defaultValue={defaults?.title} required />
      <div className="space-y-1.5">
        <label htmlFor="category" className="text-xs font-medium text-slate-400">Category</label>
        <select
          id="category"
          name="category"
          defaultValue={defaults?.category ?? 'highlight'}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          {TV_CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>
      <Field
        label="YouTube URL"
        name="youtubeUrl"
        type="url"
        defaultValue={defaults?.youtubeUrl}
        placeholder="https://youtu.be/…"
        required
      />
      <Field label="Description (optional)" name="description" defaultValue={defaults?.description} />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
        >
          {editing ? 'Save changes' : 'Add video'}
        </button>
        {state?.success && <span className="text-xs text-emerald-400">Saved.</span>}
        {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
      </div>
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  placeholder,
  required,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-xs font-medium text-slate-400">{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
