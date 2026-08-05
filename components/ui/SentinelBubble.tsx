'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'
import { toWhatsAppNumber } from '@/lib/phone/number'

export type BubbleVariant = 'home' | 'tournaments' | 'games' | 'leaderboards'

const CONTENT: Record<BubbleVariant, { message: string; cta: string }> = {
  home: {
    message: "Welcome to Sentinel X Esports! I'm Sentinel, your guide. What would you like to do today?",
    cta: 'Ask Sentinel →',
  },
  tournaments: {
    message:
      "This is the Tournaments arena. Choose any open tournament, follow the steps and let's get you competing!",
    cta: 'Got it!',
  },
  games: {
    message: 'Choose a game you love and compete in exciting tournaments. More arenas coming soon!',
    cta: "Let's Play!",
  },
  leaderboards: {
    message:
      'This is the global leaderboard. Your performance in every game counts here. Climb higher and become a Sentinel X legend!',
    cta: 'See My Rank',
  },
}

// Every page it appears on gets its own dismiss flag — closing it on /games
// shouldn't hide it on /tournaments too.
function dismissKey(variant: BubbleVariant) {
  return `sx-guide-dismissed:${variant}`
}

function askSentinelHref(): string {
  const number = toWhatsAppNumber(process.env.NEXT_PUBLIC_ADMIN_WHATSAPP)
  return number ? `https://wa.me/${number}` : '#'
}

// Sentinel Guide Bubble — bottom-right, dismissible per page. Mounted directly
// on the four pages that use it (spec §2.3); never on /about.
export function SentinelBubble({ variant }: { variant: BubbleVariant }) {
  // Hidden until the localStorage check resolves, so a returning dismisser
  // never sees a one-frame flash of the bubble before it disappears.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey(variant)) === '1')
  }, [variant])

  if (dismissed) return null

  function dismiss() {
    localStorage.setItem(dismissKey(variant), '1')
    setDismissed(true)
  }

  const { message, cta } = CONTENT[variant]

  return (
    <div className="fixed bottom-6 right-6 z-40 w-[calc(100vw-3rem)] max-w-[18rem]">
      <div className="relative rounded-xl border border-sx-purple/30 bg-sx-surface p-4 shadow-[0_0_20px_rgba(124,58,237,0.2)]">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss Sentinel guide"
          className="absolute right-3 top-3 text-slate-400 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-2 flex items-center gap-2.5 pr-4">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-sx-purple/50 bg-sx-bg">
            <Image
              src="/mascot/mascot-bubble.png"
              alt="Sentinel"
              fill
              sizes="40px"
              className="object-cover object-top"
            />
          </div>
          <p className="text-sm font-bold text-white">Hey Gamer! 👋</p>
        </div>

        <p className="mb-3 pr-4 text-sm leading-snug text-sx-gray">{message}</p>

        {variant === 'home' ? (
          <a
            href={askSentinelHref()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={dismiss}
            className="inline-flex items-center gap-1 rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
          >
            {cta}
          </a>
        ) : variant === 'leaderboards' ? (
          <a
            href="#my-rank-row"
            onClick={dismiss}
            className="inline-flex items-center gap-1 rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
          >
            {cta}
          </a>
        ) : (
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex items-center gap-1 rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-sx-purple-light"
          >
            {cta}
          </button>
        )}
      </div>
    </div>
  )
}
