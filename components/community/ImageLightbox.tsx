'use client'
import { useEffect } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

export function ImageLightbox({
  urls,
  index,
  onClose,
  onIndexChange,
}: {
  urls: string[]
  index: number
  onClose: () => void
  onIndexChange: (i: number) => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onIndexChange((index + 1) % urls.length)
      if (e.key === 'ArrowLeft') onIndexChange((index - 1 + urls.length) % urls.length)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [index, urls.length, onClose, onIndexChange])

  return (
    <div role="dialog" aria-modal="true" aria-label="Image" className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/90" onClick={onClose} />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      {urls.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => onIndexChange((index - 1 + urls.length) % urls.length)}
            aria-label="Previous image"
            className="absolute left-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:left-4"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => onIndexChange((index + 1) % urls.length)}
            aria-label="Next image"
            className="absolute right-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:right-4"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={urls[index]}
        alt=""
        className="relative max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
      />
    </div>
  )
}
