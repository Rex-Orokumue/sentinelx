'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { formatDateTime } from '@/lib/format'
import { resolveDmReport, setMessagingMuted, type AdminActionState } from '@/lib/messages/admin-actions'
import type { DmReportView } from '@/lib/messages/admin-query'

export function DmReportRow({ report }: { report: DmReportView }) {
  const [resolveState, resolveAction] = useFormState<AdminActionState, FormData>(resolveDmReport, undefined)
  const [muteState, muteAction] = useFormState<AdminActionState, FormData>(setMessagingMuted, undefined)
  const [open, setOpen] = useState(!report.resolvedAt)

  return (
    <div className={`rounded-xl border p-3 ${report.resolvedAt ? 'border-slate-800 bg-slate-900/40 opacity-70' : 'border-red-900/50 bg-slate-900/60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">
            {report.reporterName ?? 'Someone'} reported {report.reportedName ?? 'a player'} · {formatDateTime(report.createdAt)}
            {report.resolvedAt && <span className="ml-2 text-green-500">· resolved</span>}
          </p>
          <p className="mt-1 text-sm text-slate-200">{report.reason}</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {report.reportedName ?? 'This player'} messaged{' '}
            <span className={report.reportedNewContacts24h >= 8 ? 'font-bold text-amber-400' : 'text-slate-300'}>
              {report.reportedNewContacts24h}
            </span>{' '}
            new {report.reportedNewContacts24h === 1 ? 'person' : 'people'} in the last 24h
            {report.reportedMuted && <span className="ml-2 rounded bg-amber-900/50 px-1.5 py-0.5 font-bold text-amber-300">muted</span>}
          </p>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 text-xs font-semibold text-violet-400">
          {open ? 'Hide' : 'View'} thread
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-1.5 rounded-lg border border-slate-800 bg-slate-950 p-2">
          {report.transcript.map((m) => (
            <div key={m.id} className={`text-xs ${m.flagged ? 'rounded bg-red-950/50 px-1.5 py-1' : ''}`}>
              <span className="font-bold text-slate-300">{m.senderName}: </span>
              {m.body && <span className="text-slate-200">{m.body}</span>}
              {m.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.imageUrl} alt="" className="mt-1 max-h-40 rounded border border-slate-800" />
              )}
              <span className="ml-2 text-[10px] text-slate-600">{formatDateTime(m.createdAt)}</span>
              {m.deletedAt && (
                <span className="ml-2 rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  unsent by sender at {formatDateTime(m.deletedAt)}
                </span>
              )}
              {m.editHistory.length > 0 && (
                <div className="mt-0.5 text-[10px] text-slate-500">
                  edited — original: &ldquo;{m.editHistory[0].bodyBefore ?? '(no text)'}&rdquo;
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <form action={muteAction}>
          <input type="hidden" name="playerId" value={report.reportedId} />
          <input type="hidden" name="muted" value={(!report.reportedMuted).toString()} />
          <button type="submit" className="rounded-lg border border-amber-700/60 px-3 py-1 text-xs font-bold text-amber-400 hover:bg-amber-950/40">
            {report.reportedMuted ? 'Unmute messaging' : 'Mute messaging'}
          </button>
        </form>
        {!report.resolvedAt && (
          <form action={resolveAction} className="ml-auto flex items-center gap-2">
            <input type="hidden" name="id" value={report.id} />
            {report.flaggedMessageId && (
              <label className="flex items-center gap-1 text-[11px] text-slate-400">
                <input type="checkbox" name="deleteMessageId" value={report.flaggedMessageId} /> delete flagged message
              </label>
            )}
            <button type="submit" className="rounded-lg bg-green-600/80 px-3 py-1 text-xs font-bold text-white hover:bg-green-600">
              Resolve
            </button>
          </form>
        )}
      </div>
      {resolveState?.error && <p className="mt-1 text-[11px] text-red-400">{resolveState.error}</p>}
      {muteState?.error && <p className="mt-1 text-[11px] text-red-400">{muteState.error}</p>}
    </div>
  )
}
