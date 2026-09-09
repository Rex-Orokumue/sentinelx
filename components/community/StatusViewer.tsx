'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Eye, Trash2 } from 'lucide-react'
import type { StatusRing } from '@/lib/community/statuses'
import { Avatar } from '@/components/shared/Avatar'
import { formatRelativeTime } from '@/lib/format'
import { recordStatusView, deleteStatus, getStatusViewers, type StatusViewerRow } from '@/lib/community/status-actions'

const SEGMENT_MS = 5000
const TICK_MS = 50

export function StatusViewer({
  rings,
  startIndex,
  viewerId,
  onSeen,
  onClose,
}: {
  rings: StatusRing[]
  startIndex: number
  viewerId: string | null
  onSeen: (ids: string[]) => void
  onClose: () => void
}) {
  const router = useRouter()
  const [ringIdx, setRingIdx] = useState(startIndex)
  const [segIdx, setSegIdx] = useState(0)
  const [progress, setProgress] = useState(0) // 0..1 within the current segment
  const [paused, setPaused] = useState(false)
  const [showViewers, setShowViewers] = useState(false)
  const [viewers, setViewers] = useState<StatusViewerRow[]>([])
  const recorded = useRef<Set<string>>(new Set())

  const ring = rings[ringIdx]
  const status = ring?.statuses[segIdx]

  const close = useCallback(() => onClose(), [onClose])

  const goNext = useCallback(() => {
    setProgress(0)
    const current = rings[ringIdx]
    if (current && segIdx + 1 < current.statuses.length) {
      setSegIdx(segIdx + 1)
    } else if (ringIdx + 1 < rings.length) {
      setRingIdx(ringIdx + 1)
      setSegIdx(0)
    } else {
      close()
    }
  }, [rings, ringIdx, segIdx, close])

  const goPrev = useCallback(() => {
    setProgress(0)
    if (segIdx > 0) {
      setSegIdx(segIdx - 1)
    } else if (ringIdx > 0) {
      setRingIdx(ringIdx - 1)
      setSegIdx(0)
    }
  }, [ringIdx, segIdx])

  // Record a view once per status (skip the viewer's own ring — they authored it).
  useEffect(() => {
    if (!status || !ring) return
    if (recorded.current.has(status.id)) return
    recorded.current.add(status.id)
    if (!ring.isSelf && viewerId) {
      void recordStatusView(status.id)
      onSeen([status.id])
    }
  }, [status, ring, viewerId, onSeen])

  // Auto-advance timer.
  useEffect(() => {
    if (!status || paused || showViewers) return
    const id = setInterval(() => {
      setProgress((p) => {
        const next = p + TICK_MS / SEGMENT_MS
        if (next >= 1) {
          clearInterval(id)
          goNext()
          return 0
        }
        return next
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [status, paused, showViewers, goNext])

  // Keyboard + scroll lock.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [close, goNext, goPrev])

  async function openViewers() {
    if (!status) return
    setShowViewers(true)
    setViewers(await getStatusViewers(status.id))
  }

  async function onDelete() {
    if (!status) return
    const res = await deleteStatus(status.id)
    if (res.error) {
      window.alert(res.error)
      return
    }
    router.refresh()
    goNext()
  }

  if (!ring || !status) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={`${ring.authorName}'s status`}
    >
      {/* progress bars */}
      <div className="flex gap-1 p-2">
        {ring.statuses.map((s, i) => (
          <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              className="h-full bg-white"
              style={{ width: `${i < segIdx ? 100 : i === segIdx ? progress * 100 : 0}%` }}
            />
          </div>
        ))}
      </div>

      {/* header */}
      <div className="flex items-center gap-2 px-3 pb-2">
        <Avatar avatarUrl={ring.authorAvatarUrl} displayName={ring.authorName} username={ring.authorUsername} size={32} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{ring.isSelf ? 'Your status' : ring.authorName}</p>
          <p className="text-[11px] text-white/60">{formatRelativeTime(status.createdAt)}</p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="ml-auto rounded-lg p-1 text-white/80 hover:text-white"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* content + tap zones */}
      <div
        className="relative flex-1"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        {status.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={status.imageUrl} alt={status.caption ?? ''} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-sx-purple/40 to-black p-8">
            <p className="text-center text-xl font-bold text-white">{status.caption}</p>
          </div>
        )}
        {status.imageUrl && status.caption && (
          <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pb-8 text-center text-sm text-white">
            {status.caption}
          </p>
        )}
        {/* invisible tap targets */}
        <button type="button" aria-label="Previous" className="absolute inset-y-0 left-0 w-1/3" onClick={goPrev} />
        <button type="button" aria-label="Next" className="absolute inset-y-0 right-0 w-2/3" onClick={goNext} />
      </div>

      {/* own-status footer: viewers + delete */}
      {ring.isSelf && (
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={openViewers}
            className="flex items-center gap-1.5 text-xs font-semibold text-white/80"
          >
            <Eye className="h-4 w-4" /> Seen by
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1.5 text-xs font-semibold text-red-400"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      )}

      {/* seen-by sheet */}
      {showViewers && (
        <div className="absolute inset-0 z-10 flex items-end bg-black/60" onClick={() => setShowViewers(false)}>
          <div
            className="max-h-[60vh] w-full overflow-y-auto rounded-t-2xl border-t border-sx-border bg-sx-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 text-sm font-black uppercase tracking-widest text-sx-white">Seen by {viewers.length}</p>
            {viewers.length === 0 ? (
              <p className="py-6 text-center text-xs text-sx-gray">No views yet.</p>
            ) : (
              <ul className="space-y-2">
                {viewers.map((v) => (
                  <li key={v.viewerId} className="flex items-center gap-2.5">
                    <Avatar avatarUrl={v.avatarUrl} displayName={v.name} username={v.username} size={28} />
                    <span className="text-sm text-sx-white">{v.name}</span>
                    <span className="ml-auto text-[11px] text-sx-gray">{formatRelativeTime(v.viewedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
