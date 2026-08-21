'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { GuidePanel } from './GuidePanel'

const SEEN_KEY = 'sx-guide-seen'

// Site-wide floating launcher (spec §GuideLauncher) — replaces SentinelBubble
// outright (see Task 9). Mounted once in app/layout.tsx, sibling to
// SiteHeader/SiteFooter, so it survives client-side navigation without
// remounting.
export function GuideLauncher({
  isLoggedIn,
  username,
  avatarUrl,
}: {
  isLoggedIn: boolean
  username: string | null
  avatarUrl: string | null
}) {
  const [open, setOpen] = useState(false)
  // Defaults to "seen" so the pulse never flashes for one frame before the
  // localStorage check resolves — same guard SentinelBubble used for its
  // own dismiss flag.
  const [seen, setSeen] = useState(true)

  useEffect(() => {
    // Spec error-handling: localStorage unavailable (e.g. some private-
    // browsing modes throw on access, not just return null) must degrade
    // to "pulse always shows" — cosmetic only, never a functional break.
    try {
      setSeen(localStorage.getItem(SEEN_KEY) === '1')
    } catch {
      setSeen(false)
    }
  }, [])

  function toggle() {
    if (!seen) {
      try {
        localStorage.setItem(SEEN_KEY, '1')
      } catch {
        // Same degradation — dismiss still works for this session via
        // `setSeen(true)` below, it just won't persist across a reload.
      }
      setSeen(true)
    }
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label="Open Sentinel guide"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border-2 border-sx-purple/50 bg-sx-surface shadow-[0_0_20px_rgba(124,58,237,0.3)] transition-transform hover:scale-105"
      >
        <div className="relative h-10 w-10 overflow-hidden rounded-full">
          <Image
            src="/mascot/mascot-bubble.png"
            alt="Sentinel guide"
            fill
            sizes="40px"
            className={`object-cover object-top ${seen ? '' : 'animate-idle-pulse'}`}
          />
        </div>
      </button>
      {open && <GuidePanel isLoggedIn={isLoggedIn} username={username} avatarUrl={avatarUrl} onClose={() => setOpen(false)} />}
    </>
  )
}
