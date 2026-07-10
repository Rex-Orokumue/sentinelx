import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ListingForm } from '@/components/exchange/ListingForm'

export const metadata: Metadata = { title: 'Sell an item — Gaming Exchange' }

export default async function NewListingPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/exchange/new')

  const { data: games } = await supabase.from('games').select('id, name').eq('active', true).order('name')

  return (
    <div className="mx-auto max-w-xl px-4 pb-20 pt-6">
      <h1 className="mb-1 text-2xl font-black text-white">Sell an item</h1>
      <p className="mb-6 text-sm text-slate-400">List a gaming account, coins, or gear. An admin reviews every listing before it goes live.</p>
      <ListingForm games={games ?? []} />
    </div>
  )
}
