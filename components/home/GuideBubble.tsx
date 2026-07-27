'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'

const DISMISS_KEY = 'guide-bubble-dismissed'

export function GuideBubble({ whatsappUrl }: { whatsappUrl: string }) {
  // Hidden until the localStorage check resolves, so a returning dismisser
  // never sees a one-frame flash of the bubble before it disappears.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1')
  }, [])

  if (dismissed) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="relative w-full max-w-xs rounded-2xl border border-violet-500/30 bg-slate-900 p-5 text-left shadow-xl">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-slate-500 transition-colors hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="mb-1 inline-block rounded-full bg-violet-600/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-300">
        I&apos;m your guide!
      </p>
      <p className="mb-3 text-sm text-slate-300">
        Welcome to <span className="font-bold text-violet-400">Sentinel X Esports!</span> I&apos;m your
        guide. Let me help you get started.
      </p>
      <div className="flex flex-col gap-2">
        <Link href="/tournaments" className="text-sm font-semibold text-violet-400 hover:text-violet-300">
          Browse Tournaments →
        </Link>
        <Link href="#how-it-works" className="text-sm font-semibold text-violet-400 hover:text-violet-300">
          How It Works →
        </Link>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-violet-400 hover:text-violet-300"
        >
          Join WhatsApp →
        </a>
      </div>
    </div>
  )
}
