'use client'
import { useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { useFormState } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import { submitMatchResult, type SubmitResultState } from '@/lib/matches/actions'
import { buildRecordingWhatsAppUrl } from '@/lib/matches/recording-whatsapp'

export function ResultSubmissionForm({
  matchId,
  playerAName,
  playerBName,
  username,
  tournamentTitle,
  initial,
}: {
  matchId: string
  playerAName: string
  playerBName: string
  username: string
  tournamentTitle: string
  initial: { scoreA: number | null; scoreB: number | null; recordingUrl: string | null; hasScreenshot: boolean } | null
}) {
  const [state, formAction] = useFormState<SubmitResultState, FormData>(submitMatchResult, undefined)
  const [uploading, setUploading] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const recordingWhatsAppUrl = buildRecordingWhatsAppUrl({
    adminWhatsapp: process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? null,
    username,
    tournamentTitle,
    playerAName,
    playerBName,
  })

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setClientError(null)
    const fd = new FormData(e.currentTarget)
    const file = fd.get('screenshot') as File | null
    fd.delete('screenshot')

    const hasNewFile = file && file.size > 0
    if (!hasNewFile && !initial?.hasScreenshot) {
      setClientError('A screenshot is required.')
      return
    }

    if (hasNewFile) {
      setUploading(true)
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setUploading(false)
        setClientError('Please log in.')
        return
      }
      const safeName = file!.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${user.id}/${matchId}/${Date.now()}-${safeName}`
      const { error } = await supabase.storage.from('match-evidence').upload(path, file!, { upsert: false })
      setUploading(false)
      if (error) {
        setClientError('Screenshot upload failed. Please try again.')
        return
      }
      fd.set('screenshotPath', path)
    } else {
      fd.set('screenshotPath', '')
    }

    fd.set('matchId', matchId)
    startTransition(() => formAction(fd))
  }

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center text-sm font-semibold text-emerald-400">
        ✓ Result submitted — awaiting admin review. You can edit it here until an admin opens it.
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-base font-bold text-white">Submit your result</h2>

      <div className="flex items-end gap-3">
        <ScoreField label={playerAName} name="scoreA" defaultValue={initial?.scoreA ?? undefined} />
        <span className="pb-2 text-slate-500">–</span>
        <ScoreField label={playerBName} name="scoreB" defaultValue={initial?.scoreB ?? undefined} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="screenshot" className="text-sm font-medium text-slate-300">
          Screenshot {initial?.hasScreenshot ? '(uploaded — choose a new file to replace)' : '(required)'}
        </label>
        <input
          id="screenshot"
          name="screenshot"
          type="file"
          accept="image/*"
          className="block w-full text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-600 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-violet-500"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="recordingUrl" className="text-sm font-medium text-slate-300">
          Recording URL <span className="text-slate-500">(optional — YouTube/Drive link)</span>
        </label>
        <input
          id="recordingUrl"
          name="recordingUrl"
          type="url"
          defaultValue={initial?.recordingUrl ?? ''}
          placeholder="https://…"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>

      {recordingWhatsAppUrl && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-500">
            Prefer to send the full video? Message it to us on WhatsApp.
          </p>
          <a
            href={recordingWhatsAppUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-5 py-2.5 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
          >
            Submit recording via WhatsApp
          </a>
        </div>
      )}

      {(clientError || state?.error) && (
        <p className="text-sm text-red-400">{clientError ?? state?.error}</p>
      )}

      <button
        type="submit"
        disabled={uploading}
        className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
      >
        {uploading ? 'Uploading…' : initial ? 'Update result' : 'Submit result'}
      </button>
    </form>
  )
}

function ScoreField({ label, name, defaultValue }: { label: string; name: string; defaultValue?: number }) {
  return (
    <div className="flex-1 space-y-1.5">
      <label htmlFor={name} className="block truncate text-xs font-medium text-slate-400">{label}</label>
      <input
        id={name}
        name={name}
        type="number"
        min={0}
        max={99}
        required
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center text-lg font-bold text-white focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
