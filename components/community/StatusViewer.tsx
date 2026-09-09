'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, Eye, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { StatusRing } from '@/lib/community/statuses'
import { Avatar } from '@/components/shared/Avatar'
import { formatRelativeTime } from '@/lib/format'
import { recordStatusView, deleteStatus, getStatusViewers, type StatusViewerRow } from '@/lib/community/status-actions'

const SEGMENT_MS = 5000
const TICK_MS = 50
const VIEWERS_POLL_MS = 4000

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
  const [viewersLoading, setViewersLoading] = useState(false)
  const recorded = useRef<Set<string>>(new Set())
  const viewersReq = useRef(0)

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
      if (e.key === 'Escape') {
        if (showViewers) setShowViewers(false)
        else close()
      }
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
  }, [close, goNext, goPrev, showViewers])

  // The seen-by sheet belongs to one status — close it the moment playback moves on.
  const statusId = status?.id
  useEffect(() => {
    setShowViewers(false)
  }, [statusId])

  const loadViewers = useCallback(async (id: string, showSpinner: boolean) => {
    const reqId = ++viewersReq.current
    if (showSpinner) setViewersLoading(true)
    const rows = await getStatusViewers(id)
    if (viewersReq.current === reqId) {
      setViewers(rows)
      setViewersLoading(false)
    }
  }, [])

  function openViewers() {
    if (!statusId) return
    setViewers([])
    setShowViewers(true)
    void loadViewers(statusId, true)
  }

  // While the sheet is open, keep it fresh — a view can land after you opened it,
  // and status_views is deliberately not on realtime.
  useEffect(() => {
    if (!showViewers || !statusId) return
    const id = setInterval(() => void loadViewers(statusId, false), VIEWERS_POLL_MS)
    return () => clearInterval(id)
  }, [showViewers, statusId, loadViewers])

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
      className="fixed inset-0 z-[80] flex justify-center bg-black/95 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${ring.authorName}'s status`}
      onClick={close}
    >
      {/* Phone-shaped card: full-bleed on mobile, centred and bounded on desktop.
          A fixed card height is what lets the media area use min-h-0 + object-contain
          instead of the image inflating the layout. */}
      <div
        className="relative flex h-full w-full max-w-[460px] flex-col overflow-hidden bg-black sm:h-[min(92vh,860px)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* top overlay: progress bars + author, scrimmed for legibility over bright images */}
        <div className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent px-2 pb-8 pt-2">
          <div className="flex gap-1">
            {ring.statuses.map((s, i) => (
              <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
                <div
                  className="h-full bg-white"
                  style={{ width: `${i < segIdx ? 100 : i === segIdx ? progress * 100 : 0}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 px-1">
            <Avatar avatarUrl={ring.authorAvatarUrl} displayName={ring.authorName} username={ring.authorUsername} size={30} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">{ring.isSelf ? 'Your status' : ring.authorName}</p>
              <p className="text-[11px] text-white/70">{formatRelativeTime(status.createdAt)}</p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* media stage — bounded by the card, so object-contain letterboxes instead of overflowing */}
        <div
          className="relative flex min-h-0 flex-1 items-center justify-center"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
        >
          {status.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={status.imageUrl} alt={status.caption ?? ''} className="max-h-full max-w-full object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-sx-purple/40 to-black p-8">
              <p className="text-center text-xl font-bold text-white">{status.caption}</p>
            </div>
          )}
          {status.imageUrl && status.caption && (
            <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pb-6 text-center text-sm text-white">
              {status.caption}
            </p>
          )}

          {/* tap targets: left third = back, right two-thirds = forward */}
          <button type="button" aria-label="Previous" className="absolute inset-y-0 left-0 w-1/3" onClick={goPrev} />
          <button type="button" aria-label="Next" className="absolute inset-y-0 right-0 w-2/3" onClick={goNext} />

          {/* visible chevrons on desktop for discoverability (matches ImageLightbox) */}
          <button
            type="button"
            onClick={goPrev}
            aria-hidden
            tabIndex={-1}
            className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-hidden
            tabIndex={-1}
            className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* own-status footer: always visible below the stage */}
        {ring.isSelf && (
          <div className="flex shrink-0 items-center justify-between bg-black px-4 py-3">
            <button
              type="button"
              onClick={openViewers}
              className="flex items-center gap-1.5 text-xs font-semibold text-white/80 hover:text-white"
            >
              <Eye className="h-4 w-4" /> Seen by
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:text-red-300"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        )}

        {/* seen-by sheet */}
        {showViewers && (
          <div className="absolute inset-0 z-30 flex items-end bg-black/60" onClick={() => setShowViewers(false)}>
            <div
              className="max-h-[60%] w-full overflow-y-auto rounded-t-2xl border-t border-sx-border bg-sx-surface p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="mb-3 text-sm font-black uppercase tracking-widest text-sx-white">
                {viewersLoading ? 'Seen by…' : `Seen by ${viewers.length}`}
              </p>
              {viewersLoading ? (
                <p className="py-6 text-center text-xs text-sx-gray">Loading…</p>
              ) : viewers.length === 0 ? (
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
    </div>
  )
}
