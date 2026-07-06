import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Dashboard · Sentinel X' }

// Placeholder dashboard — proves auth works and gives the post-login/confirm
// redirect a real destination. Full dashboard is roadmap v1.0 #8.
export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-black tracking-tight">Dashboard</h1>
      <p className="mt-2 text-sm text-slate-400">
        You're signed in{user?.email ? ` as ${user.email}` : ''}. The full player dashboard is
        coming soon.
      </p>
    </div>
  )
}
