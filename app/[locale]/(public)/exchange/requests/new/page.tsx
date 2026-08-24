import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BuyRequestForm } from '@/components/exchange/BuyRequestForm'

export const metadata: Metadata = { title: 'Request an item — Gaming Exchange' }

export default async function NewBuyRequestPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/exchange/requests/new')

  const { data: games } = await supabase.from('games').select('id, name').eq('active', true).order('name')

  return (
    <div className="mx-auto max-w-xl px-4 pb-20 pt-6">
      <h1 className="mb-1 text-2xl font-black text-white">Request an item</h1>
      <p className="mb-6 text-sm text-slate-400">
        Tell us what you&apos;re looking for. This goes straight to a SentinelX admin, never posted publicly.
      </p>
      <BuyRequestForm games={games ?? []} />
    </div>
  )
}
