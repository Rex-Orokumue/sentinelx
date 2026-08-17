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

// Called only from an explicit user action (Settings' "Enable Push
// Notifications" button, or PushPermissionPrompt after a meaningful event)
// — never on page load. Returns false if push isn't available (no Firebase
// project configured, permission denied, or unsupported browser) so the
// caller can show an appropriate message instead of assuming success.
export async function requestPushPermission(): Promise<boolean> {
  const app = getFirebaseApp()
  if (!app || typeof window === 'undefined' || !('Notification' in window)) return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${swQueryString()}`)
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
