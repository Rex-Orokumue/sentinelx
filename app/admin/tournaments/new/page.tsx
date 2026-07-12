import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { createTournament } from '@/lib/tournaments/admin-actions'
import { TournamentForm, type TournamentFormValues } from '@/components/admin/TournamentForm'

export const metadata: Metadata = { title: 'New tournament · Admin · SentinelX' }

const EMPTY: TournamentFormValues = {
  title: '',
  slug: '',
  gameId: '',
  description: '',
  bannerUrl: '',
  registrationFee: '500',
  prizePool: '0',
  maxPlayers: '',
  registrationStart: '',
  registrationEnd: '',
  tournamentStart: '',
  tournamentEnd: '',
  rules: '',
}

export default async function NewTournamentPage() {
  await requireStaff()
  const supabase = createClient()
  const { data: games } = await supabase
    .from('games')
    .select('id, name')
    .eq('active', true)
    .order('name')

  return (
    <section className="max-w-xl">
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">New tournament</h2>
      {(games ?? []).length === 0 ? (
        <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-300">
          No active games exist yet. Seed at least one game before creating a tournament.
        </p>
      ) : (
        <TournamentForm
          action={createTournament}
          games={games ?? []}
          initial={EMPTY}
          slugLocked={false}
          submitLabel="Create tournament"
        />
      )}
    </section>
  )
}
