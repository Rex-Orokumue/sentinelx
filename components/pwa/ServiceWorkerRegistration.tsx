'use client'
import { useEffect } from 'react'
import { registerServiceWorker, refreshPushToken } from '@/components/notifications/useFCM'

// Mounted unconditionally in the root layout for every visitor, logged in
// or not — PWA installability requires an active service worker regardless
// of login state or push permission. Renders nothing; registration itself
// never prompts the user for anything.
export function ServiceWorkerRegistration({ isLoggedIn }: { isLoggedIn: boolean }) {
  useEffect(() => {
    registerServiceWorker()
    // Repairs a token that was lost to sign-out, FCM rotation or stale-token
    // cleanup. Silent by construction — refreshPushToken bails unless
    // permission is ALREADY granted, so this never prompts. Only worth doing
    // for a signed-in player, since a token has to belong to somebody.
    if (isLoggedIn) void refreshPushToken()
  }, [isLoggedIn])
  return null
}
