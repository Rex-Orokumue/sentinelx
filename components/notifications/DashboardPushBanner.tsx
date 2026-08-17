'use client'
import { useEffect, useState } from 'react'
import { getFirebaseApp } from '@/lib/firebase/client'
import { PushPermissionPrompt } from './PushPermissionPrompt'

const SNOOZE_KEY = 'sx-push-banner-snoozed-until'
const SNOOZE_DAYS = 7

// Shown at the top of every /dashboard/* page (mounted in DashboardShell).
// Only appears when push is genuinely available and not yet decided:
// Notification.permission === 'default' (never asked, and not already
// denied — we can't reprompt a denial anyway, the browser just silently
// re-denies), Firebase is actually configured client-side (no point
// prompting toward a request that's guaranteed to fail), and the player
// hasn't snoozed it within the last 7 days. Dismissing snoozes; enabling
// successfully needs no separate persistence — permission becomes
// 'granted', which this same check keeps hidden on every future mount.
export function DashboardPushBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'default') return
    if (!getFirebaseApp()) return
    const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY) ?? 0)
    if (Date.now() < snoozedUntil) return
    setVisible(true)
  }, [])

  function handleDismiss() {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000))
    setVisible(false)
  }

  if (!visible) return null
  return <PushPermissionPrompt onDismiss={handleDismiss} />
}
