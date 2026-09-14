import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Auth guard only — presence tracking (PresenceProvider) now mounts once,
// site-wide, in the root [locale] layout so the DM online dot stays
// accurate anywhere on the site, not just while a Messages page is open.
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/messages')

  return children
}
