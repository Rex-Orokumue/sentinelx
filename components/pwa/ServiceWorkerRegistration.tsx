'use client'
import { useEffect } from 'react'
import { registerServiceWorker } from '@/components/notifications/useFCM'

// Mounted unconditionally in the root layout for every visitor, logged in
// or not — PWA installability requires an active service worker regardless
// of login state or push permission. Renders nothing; registration itself
// never prompts the user for anything.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    registerServiceWorker()
  }, [])
  return null
}
