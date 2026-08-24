import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { GameForm } from '@/components/admin/GameForm'
import { GameRow } from '@/components/admin/GameRow'

export const metadata: Metadata = { title: 'Games · Admin · SentinelX' }

export default async function AdminGamesPage() {
  await requireStaff()
  const supabase = createClient()
  const { data: games } = await supabase.from('games').select('id, name, category, active').order('name')

  const rows = games ?? []
  const tournamentCounts = await Promise.all(
    rows.map(async (g) => {
      const { count } = await supabase
        .from('tournaments')
        .select('id', { count: 'exact', head: true })
        .eq('game_id', g.id)
        .not('status', 'in', '(completed,cancelled)')
      return count ?? 0
    }),
  )

  return (
    <section>
      <h2 className="mb-4 text-base font-bold text-white">Games</h2>
      <div className="mb-6">
        <GameForm />
      </div>
      <div className="space-y-2">
        {rows.map((g, i) => (
          <GameRow key={g.id} game={g} activeTournamentCount={tournamentCounts[i]} />
        ))}
      </div>
    </section>
  )
}
