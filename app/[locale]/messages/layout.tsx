import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PresenceProvider } from '@/components/messages/PresenceProvider'

// Wraps both the thread list and thread detail pages so presence tracking
// (who's online) starts the moment either is mounted and survives
// navigating between them, instead of resetting per-page.
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/messages')

  return <PresenceProvider viewerId={user.id}>{children}</PresenceProvider>
}
