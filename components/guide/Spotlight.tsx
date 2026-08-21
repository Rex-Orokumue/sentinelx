'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'

// Dim-overlay + cutout-highlight + mascot callout, positioned via
// getBoundingClientRect() on a target element already present in the DOM.
// Same-page only (spec §Spotlight) — the caller (GuidePanel) only renders
// this when document.getElementById(targetId) already exists; if the
// element genuinely isn't there when this mounts, dismiss immediately
// rather than showing a broken/blank overlay.
export function Spotlight({
  targetId,
  title,
  body,
  onDismiss,
}: {
  targetId: string
  title: string
  body: string
  onDismiss: () => void
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    const el = document.getElementById(targetId)
    if (!el) {
      onDismiss()
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    function measure() {
      setRect(el!.getBoundingClientRect())
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  if (!rect) return null

  const calloutTop = Math.min(rect.bottom + 16, window.innerHeight - 180)
  const calloutLeft = Math.max(16, Math.min(rect.left, window.innerWidth - 304))

  return createPortal(
    <div className="fixed inset-0 z-[70]" onClick={onDismiss}>
      {/* The cutout: a transparent box whose huge box-shadow dims everything
          else on the page in one element, instead of a separate overlay +
          clip-path. Same purple glow as the rest of the Phase 1 system. */}
      <div
        className="absolute rounded-xl ring-4 ring-sx-purple"
        style={{
          top: rect.top - 8,
          left: rect.left - 8,
          width: rect.width + 16,
          height: rect.height + 16,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.75), 0 0 24px rgba(124,58,237,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        className="absolute w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-sx-purple/40 bg-sx-surface p-4 shadow-[0_0_20px_rgba(124,58,237,0.3)]"
        style={{ top: calloutTop, left: calloutLeft }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full border-2 border-sx-purple/50 bg-sx-bg">
            <Image src="/mascot/mascot-bubble.png" alt="Sentinel" fill sizes="28px" className="object-cover object-top" />
          </div>
          <p className="text-sm font-bold text-white">{title}</p>
        </div>
        <p className="mb-3 text-xs leading-snug text-sx-gray">{body}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg bg-sx-purple px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
        >
          Got it
        </button>
      </div>
    </div>,
    document.body,
  )
}
