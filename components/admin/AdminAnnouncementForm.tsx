'use client'
import { useRef } from 'react'
import { useFormState } from 'react-dom'
import { createAnnouncement, type AdminActionState } from '@/lib/community/admin-actions'

export function AdminAnnouncementForm() {
  const [state, action] = useFormState<AdminActionState, FormData>(createAnnouncement, undefined)
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <form
      ref={formRef}
      action={(fd) => {
        action(fd)
        formRef.current?.reset()
      }}
      className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
    >
      <p className="text-sm font-bold text-white">Post an announcement</p>
      <p className="text-xs text-slate-500">Always pinned above the rest of the feed.</p>
      <textarea
        name="content"
        rows={3}
        maxLength={500}
        placeholder="🏆 Season 1 Community Club #4 registrations are now open! Entry fee: ₦500. Register before Sunday 8 PM. https://…"
        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-end">
        <button type="submit" className="rounded-lg bg-violet-600 px-5 py-2 text-xs font-bold text-white hover:bg-violet-500">
          Post announcement
        </button>
      </div>
      {state?.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}
    </form>
  )
}
