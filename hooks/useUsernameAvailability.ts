'use client'
import { useEffect, useState } from 'react'
import { usernameSchema } from '@/lib/auth/schema'
import { checkUsernameAvailability } from './checkUsernameAvailability'

export type Status = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'unknown'

export function useUsernameAvailability(username: string): Status {
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    const parsed = usernameSchema.safeParse(username)
    if (!parsed.success) {
      setStatus(username.length === 0 ? 'idle' : 'invalid')
      return
    }
    setStatus('checking')
    let cancelled = false
    const handle = setTimeout(async () => {
      const result = await checkUsernameAvailability(parsed.data)
      if (!cancelled) setStatus(result)
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [username])

  return status
}
