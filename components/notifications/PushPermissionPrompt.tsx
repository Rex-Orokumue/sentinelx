'use client'
import { useState } from 'react'
import { requestPushPermission } from './useFCM'

// A small dismissible banner, not a modal — shown by a parent after a
// meaningful event (first registration, first result confirmed). The
// parent owns whether/when to render this; this component only owns the
// button's pending/result state.
export function PushPermissionPrompt({ onDismiss }: { onDismiss: () => void }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'granted' | 'denied'>('idle')

  async function handleEnable() {
    setStatus('pending')
    const ok = await requestPushPermission()
    setStatus(ok ? 'granted' : 'denied')
    if (ok) setTimeout(onDismiss, 1500)
  }

  if (status === 'granted') {
    return <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-300">Push notifications enabled 🎮</div>
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-sx-border bg-sx-surface p-4">
      <p className="text-sm text-white">Get notified the moment your match result is confirmed — even off-site.</p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={handleEnable}
          disabled={status === 'pending'}
          className="rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white hover:bg-sx-purple-light disabled:opacity-60"
        >
          {status === 'pending' ? 'Enabling…' : 'Enable'}
        </button>
        <button type="button" onClick={onDismiss} className="rounded-lg px-3 py-2 text-xs text-sx-gray hover:text-white">
          Not now
        </button>
      </div>
      {status === 'denied' && <p className="text-xs text-red-400">Could not enable push — check your browser's notification permission.</p>}
    </div>
  )
}
