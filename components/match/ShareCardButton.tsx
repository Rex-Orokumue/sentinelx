'use client'
import { useState } from 'react'

export function ShareCardButton({ matchId, shareText }: { matchId: string; shareText: string }) {
  const [state, setState] = useState<'idle' | 'busy'>('idle')

  async function handleShare() {
    setState('busy')
    try {
      const res = await fetch(`/api/matches/${matchId}/card`)
      if (!res.ok) throw new Error('card fetch failed')
      const blob = await res.blob()
      const file = new File([blob], 'sentinel-x-match.png', { type: 'image/png' })

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Sentinel X', text: shareText })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'sentinel-x-match.png'
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch {
      // A user cancelling the native share sheet also lands here (share()
      // rejects on cancel) — that isn't a real error, so don't surface it
      // as one.
    } finally {
      setState('idle')
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={state === 'busy'}
      className="inline-flex items-center gap-2 rounded-xl border border-violet-500/40 px-6 py-3 text-sm font-bold text-violet-400 transition-colors hover:bg-violet-500/10 disabled:opacity-50"
    >
      {state === 'busy' ? 'Preparing…' : 'Share card'}
    </button>
  )
}
