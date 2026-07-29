import Link from 'next/link'
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { buildBracketTree } from '@/lib/tournaments/bracket-tree'

// A bracket is inherently wider than a phone, so the tree scrolls horizontally
// rather than trying to squeeze rounds into 375px. Each round is a column of
// equal-height bands: a band in one column lines up with the band it feeds in
// the next, which is what makes the connectors land in the right place without
// measuring anything at runtime.
export function BracketTree({
  rounds,
  champion,
}: {
  rounds: { round: string; label: string; matches: BracketMatch[] }[]
  champion?: { id: string; name: string } | null
}) {
  const tree = buildBracketTree(rounds)
  if (tree.length === 0) return null

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold text-white">Knockout</h2>
        <span className="text-[11px] text-slate-500 sm:hidden">Scroll sideways →</span>
      </div>

      <div className="overflow-x-auto pb-3">
        <div className="flex min-w-max items-stretch">
          {tree.map((round, roundIndex) => {
            const isFinalColumn = roundIndex === tree.length - 1
            return (
              <div key={round.round} className="flex w-40 shrink-0 flex-col sm:w-48">
                <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {round.label}
                </h3>
                <div className="flex flex-1 flex-col">
                  {round.groups.map((group, groupIndex) => (
                    <div
                      key={`${round.round}-${groupIndex}`}
                      className={`relative flex flex-1 flex-col ${isFinalColumn ? '' : 'pr-4'}`}
                    >
                      {group.map((m) => (
                        // Each feeder takes an equal share of the band and
                        // centres itself, so two feeders sit at 25% and 75% of
                        // the band height — exactly where the connector expects.
                        <div key={m.id} className="flex flex-1 items-center py-1">
                          <MatchNode match={m} />
                        </div>
                      ))}
                      {!isFinalColumn && <Connector feederCount={group.length} />}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {champion && (
        <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-center text-sm font-bold text-amber-300">
          🏆 Champion: {champion.name}
        </p>
      )}
    </section>
  )
}

// Drawn in the column's right-hand gutter: a vertical spine joining the two
// feeders, then a stub out to the next round at the midpoint between them.
// With one feeder there is nothing to join, so only the stub is drawn.
function Connector({ feederCount }: { feederCount: number }) {
  if (feederCount === 0) return null
  return (
    <>
      {feederCount > 1 && (
        <span aria-hidden className="absolute right-4 top-1/4 h-1/2 w-px bg-slate-700" />
      )}
      <span aria-hidden className="absolute right-0 top-1/2 h-px w-4 bg-slate-700" />
    </>
  )
}

function MatchNode({ match }: { match: BracketMatch }) {
  const decided = match.score_a != null && match.score_b != null
  const aWon = decided && match.score_a! > match.score_b!
  const bWon = decided && match.score_b! > match.score_a!
  const isBye = match.status === 'bye' || !match.playerB.id

  return (
    <Link
      href={`/matches/${match.id}?from=bracket`}
      className={`block w-full overflow-hidden rounded-lg border bg-slate-900 transition-colors hover:border-violet-500/50 ${
        match.status === 'live' ? 'border-red-500/50' : 'border-slate-800'
      }`}
    >
      <PlayerRow name={match.playerA.name} score={match.score_a} won={aWon} />
      <div className="h-px bg-slate-800" />
      {isBye ? (
        <p className="px-2 py-1.5 text-[10px] italic text-slate-600">Bye — auto-advances</p>
      ) : (
        <PlayerRow name={match.playerB.name} score={match.score_b} won={bWon} />
      )}
    </Link>
  )
}

function PlayerRow({ name, score, won }: { name: string; score: number | null; won: boolean }) {
  return (
    <div className="flex items-center justify-between gap-1.5 px-2 py-1.5">
      <span className={`truncate text-xs ${won ? 'font-bold text-white' : 'text-slate-400'}`}>
        {name}
      </span>
      <span className={`shrink-0 text-xs tabular-nums ${won ? 'font-bold text-white' : 'text-slate-500'}`}>
        {score ?? '–'}
      </span>
    </div>
  )
}
