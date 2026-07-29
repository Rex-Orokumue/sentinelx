import Link from 'next/link'
import type { BracketMatch } from '@/lib/tournaments/bracket'
import { buildBracketDisplay, type ProjectedRound } from '@/lib/tournaments/bracket-tree'

// The full knockout chart, drawn from the start with empty slots that fill in
// as players advance — knockout rows are only created a round at a time, so
// without the projected shape the bracket would be invisible until the group
// stage ends. A bracket is wider than a phone, so it scrolls horizontally
// rather than being squeezed into 375px.
export function BracketTree({
  rounds,
  projected = [],
  champion,
}: {
  rounds: { round: string; label: string; matches: BracketMatch[] }[]
  projected?: ProjectedRound[]
  champion?: { id: string; name: string } | null
}) {
  const display = buildBracketDisplay(rounds, projected)
  if (display.length === 0) return null

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold text-white">Knockout</h2>
        <span className="text-[11px] text-slate-500 sm:hidden">Scroll sideways →</span>
      </div>

      <div className="overflow-x-auto pb-3">
        <div className="flex min-w-max items-stretch">
          {display.map((round, roundIndex) => {
            const isFinalColumn = roundIndex === display.length - 1
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
                      {group.map((slot, slotIndex) => (
                        // Each slot takes an equal share of the band and centres
                        // itself, so two slots sit at 25% and 75% of the band
                        // height — exactly where the connector expects them.
                        <div
                          key={slot?.id ?? `${round.round}-${groupIndex}-${slotIndex}`}
                          className="flex flex-1 items-center py-1"
                        >
                          {slot ? <MatchNode match={slot} /> : <EmptySlot />}
                        </div>
                      ))}
                      {!isFinalColumn && group.length > 0 && <Connector slotCount={group.length} />}
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
// slots, then a stub out to the round they feed at the midpoint between them.
function Connector({ slotCount }: { slotCount: number }) {
  return (
    <>
      {slotCount > 1 && (
        <span aria-hidden className="absolute right-4 top-1/4 h-1/2 w-px bg-slate-800" />
      )}
      <span aria-hidden className="absolute right-0 top-1/2 h-px w-4 bg-slate-800" />
    </>
  )
}

// A slot on the chart whose player hasn't been decided yet.
function EmptySlot() {
  return (
    <div className="w-full rounded-lg border border-dashed border-slate-800 bg-slate-900/30">
      <p className="px-2 py-1.5 text-xs text-slate-700">—</p>
      <div className="h-px bg-slate-800/60" />
      <p className="px-2 py-1.5 text-xs text-slate-700">—</p>
    </div>
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
