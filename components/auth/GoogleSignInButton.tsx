'use client'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

export function GoogleSignInButton({ next }: { next: string }) {
  async function handleClick() {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/oauth/callback?next=${encodeURIComponent(next)}`,
      },
    })
  }

  return (
    <Button type="button" variant="outline" className="w-full" onClick={handleClick}>
      Continue with Google
    </Button>
  )
}
