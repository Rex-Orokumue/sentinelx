'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Called from app/[locale]/error.tsx and app/global-error.tsx — the only
// place an uncaught client-side exception has anywhere to go. Runs for
// logged-out visitors too (a crash on /login is exactly the kind of thing
// we need to see), so it writes with the service-role client rather than
// relying on a client-writable RLS policy — see the migration for why.
//
// Must never throw: this is called from inside an error boundary, already
// in "something already broke" territory. A logging failure (network,
// Supabase hiccup) has to fail silently rather than replace one broken page
// with another.
export async function logClientError(input: {
  message: string
  stack?: string
  digest?: string
  url?: string
  userAgent?: string
  locale?: string
}): Promise<void> {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const admin = createAdminClient()
    await admin.from('client_error_logs').insert({
      user_id: user?.id ?? null,
      message: input.message.slice(0, 4000),
      stack: input.stack?.slice(0, 8000) ?? null,
      digest: input.digest ?? null,
      url: input.url ?? null,
      user_agent: input.userAgent ?? null,
      locale: input.locale ?? null,
    })
  } catch {
    // Swallow — see the note above.
  }
}
