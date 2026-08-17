'use client'
import { getFirebaseApp } from '@/lib/firebase/client'

function swQueryString(): string {
  const p = new URLSearchParams({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  })
  return p.toString()
}

// Registers the service worker unconditionally for every visitor,
// regardless of login state or push permission — required for PWA
// installability. Chrome (and other browsers) will not offer to install a
// site without an active, controlling service worker that has a fetch
// handler, and that has nothing to do with notification permission:
// registering a service worker itself never prompts the user for
// anything. This was missing entirely — the only place sw.js ever got
// registered was inside requestPushPermission() below, gated behind the
// "Enable Push Notifications" button, so almost no visitor ever triggered
// registration at all and the site was never actually installable.
// Registers without the Firebase query-string params (sw.js only sets up
// push messaging when those are present, guarding against a crash on
// missing config) — requestPushPermission() below re-registers the same
// scope with real params when the player opts into push, which is a
// normal, harmless service-worker update, not a conflict.
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.error('[pwa] service worker registration failed', err)
  })
}

// Called only from an explicit user action (Settings' "Enable Push
// Notifications" button, or PushPermissionPrompt after a meaningful event)
// — never automatically. Returns false if push isn't available (no
// Firebase project configured, permission denied, or unsupported browser)
// so the caller can show an appropriate message instead of assuming success.
export async function requestPushPermission(): Promise<boolean> {
  const app = getFirebaseApp()
  if (!app || typeof window === 'undefined' || !('Notification' in window)) return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const registration = await navigator.serviceWorker.register(`/sw.js?${swQueryString()}`)
  const { getMessaging, getToken } = await import('firebase/messaging')
  const messaging = getMessaging(app)
  const token = await getToken(messaging, {
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  })
  if (!token) return false

  const res = await fetch('/api/notifications/fcm-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  return res.ok
}

// Called from the Settings "Disable" button and from signOut() — removes
// every token for the current player rather than tracking "this device's"
// token client-side, which keeps the call trivially simple at the cost of
// also deregistering push on the player's other devices. Acceptable: the
// player can re-enable per-device from Settings.
export async function disablePush(): Promise<void> {
  await fetch('/api/notifications/fcm-token', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' })
}

// sw.js's onBackgroundMessage only fires when the tab is
// NOT focused — that's how FCM web push works by design, not a bug in the
// service worker. When the tab IS focused (the common case: a player is
// actively on the site when e.g. their weekly challenge completes),
// Firebase routes the message to this page-level onMessage() listener
// instead, and without one registered here, the message was received by
// the SDK and silently dropped — no toast, nothing in the OS notification
// tray. Reuses the same already-registered service worker's
// showNotification() so foreground and background pushes look identical
// and both funnel through the SW's existing `notificationclick` handler.
// Call once per session from an always-mounted client component (NotificationBell) —
// safe to call unconditionally; it's a no-op until a message actually arrives.
export function listenForegroundMessages(): void {
  const app = getFirebaseApp()
  if (!app || typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return

  import('firebase/messaging').then(({ getMessaging, onMessage }) => {
    const messaging = getMessaging(app)
    onMessage(messaging, async (payload) => {
      const registration = await navigator.serviceWorker.ready
      await registration.showNotification(payload.notification?.title ?? 'SentinelX', {
        body: payload.notification?.body,
        icon: '/logo-icon.png',
        data: payload.data,
      })
    })
  })
}
