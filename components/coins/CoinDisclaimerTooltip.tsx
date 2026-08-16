'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

// Spec §7 — shown once on first visit to the store/wallet page, then never
// again. Same dismiss-flag-in-localStorage shape as SentinelBubble
// (components/ui/SentinelBubble.tsx), simplified to a single fixed message
// with no CTA — this is a disclosure, not a guided-tour prompt.
const DISMISS_KEY = 'sx-coin-disclaimer-dismissed'

export function CoinDisclaimerTooltip() {
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
    <div className="relative mb-4 rounded-xl border border-sx-purple/30 bg-sx-surface p-4">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-slate-400 transition-colors hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="pr-6 text-sm leading-snug text-sx-gray">
        🪙 SX Coins are earned by competing and spent on the platform. <strong className="text-white">They cannot be exchanged for cash.</strong>
      </p>
    </div>
  )
}
