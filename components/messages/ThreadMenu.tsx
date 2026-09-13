'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreVertical, Ban, Flag, X } from 'lucide-react'
import { blockUser, unblockUser, reportConversation } from '@/lib/messages/actions'
import { reportReasonSchema } from '@/lib/messages/schema'

export function ThreadMenu({ threadId, otherId, otherName, blockedByMe }: { threadId: string; otherId: string; otherName: string; blockedByMe: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function toggleBlock() {
    setOpen(false)
    start(async () => {
      const res = blockedByMe ? await unblockUser(otherId) : await blockUser(otherId)
      if (res.error) setMsg(res.error)
      else router.refresh()
    })
  }

  function submitReport(e: React.FormEvent) {
    e.preventDefault()
    if (!reportReasonSchema.safeParse(reason).success) return
    start(async () => {
      const res = await reportConversation({ threadId, reason })
      if (res.error) {
        setMsg(res.error)
        return
      }
      setReporting(false)
      setReason('')
      setMsg('Report sent. Our team will review it.')
    })
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Conversation options"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/5 hover:text-white"
      >
        <MoreVertical className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-xl border border-sx-border bg-sx-surface py-1 shadow-xl">
          <button
            type="button"
            onClick={toggleBlock}
            disabled={pending}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-white/5"
          >
            <Ban className="h-4 w-4" /> {blockedByMe ? 'Unblock' : 'Block'} {otherName}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setReporting(true)
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-red-400 hover:bg-white/5"
          >
            <Flag className="h-4 w-4" /> Report
          </button>
        </div>
      )}

      {msg && <p className="absolute right-0 top-11 z-20 w-56 rounded-lg border border-sx-border bg-sx-surface p-2 text-[11px] text-sx-gray">{msg}</p>}

      {reporting && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 sm:items-center" onClick={() => setReporting(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitReport}
            className="w-full rounded-t-2xl border border-sx-border bg-sx-surface p-4 sm:max-w-sm sm:rounded-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-black uppercase tracking-widest text-white">Report {otherName}</p>
              <button type="button" onClick={() => setReporting(false)} aria-label="Close" className="text-sx-gray hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="What happened? Staff will be able to read this conversation."
              className="w-full resize-none rounded-lg border border-sx-border bg-sx-bg px-3 py-2 text-sm text-white placeholder:text-sx-gray focus:border-sx-purple focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={pending || !reportReasonSchema.safeParse(reason).success}
              className="mt-3 w-full rounded-lg bg-red-500/90 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {pending ? 'Sending…' : 'Send report'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
