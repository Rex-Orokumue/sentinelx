import { Gamepad2 } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'

export interface PlayedGame {
  name: string
  wins: number
  matches: number
}

// "Games You Play" (spec §3.5) — real per-game wins/matches, not the fabricated
// per-game SX Score + rank the mockup shows (that needs a per-game score
// column the schema doesn't have yet — see roadmap #21 multi-game support).
export function ProfileGamesRow({ games }: { games: PlayedGame[] }) {
  return (
    <section id="games" className="scroll-mt-24">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">Games You Play</h2>
      </div>
      {games.length === 0 ? (
        <EmptyState icon="🎮" title="No games yet" body="Games this player has competed in will show up here." />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-1 scrollbar-hide">
          {games.map((g) => (
            <div
              key={g.name}
              className="min-w-[140px] shrink-0 rounded-xl border border-sx-border bg-sx-surface p-4 text-center"
            >
              <Gamepad2 className="mx-auto mb-2 h-6 w-6 text-sx-purple-text" />
              <p className="truncate text-sm font-bold text-white">{g.name}</p>
              <p className="mt-1 text-xs text-sx-gray">
                {g.wins} win{g.wins === 1 ? '' : 's'} · {g.matches} match{g.matches === 1 ? '' : 'es'}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
