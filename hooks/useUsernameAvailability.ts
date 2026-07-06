'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usernameSchema } from '@/lib/auth/schema'

type Status = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'

export function useUsernameAvailability(username: string): Status {
  const [status, setStatus] = useState<Status>('idle')

  useEffect(() => {
    const parsed = usernameSchema.safeParse(username)
    if (!parsed.success) {
      setStatus(username.length === 0 ? 'idle' : 'invalid')
      return
    }
    setStatus('checking')
    const handle = setTimeout(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', parsed.data)
        .maybeSingle()
      setStatus(data ? 'taken' : 'available')
    }, 400)
    return () => clearTimeout(handle)
  }, [username])

  return status
}
