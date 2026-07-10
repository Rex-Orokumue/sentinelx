'use client'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { youtubeEmbedUrl } from '@/lib/matches/youtube'

export function VideoModal({
  videoId,
  title,
  onClose,
}: {
  videoId: string
  title: string
  onClose: () => void
}) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
    >
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full sm:max-w-3xl sm:px-4">
        <div className="overflow-hidden rounded-t-2xl border border-slate-800 bg-slate-950 sm:rounded-2xl">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <p className="truncate text-sm font-bold text-white">{title}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1 text-slate-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="relative aspect-video w-full">
            <iframe
              src={youtubeEmbedUrl(videoId, { autoplay: true, mute: true })}
              title={title}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </div>
  )
}
