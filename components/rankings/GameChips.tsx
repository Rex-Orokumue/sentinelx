import type { GameChips as GameChipsData } from '@/lib/rankings/game-chips'

// The Games Played cell: which games a player competes in, capped so the row
// stays one line, plus the total. Complements the wins expander, which shows
// how many wins in each.
export function GameChips({ data }: { data: GameChipsData }) {
  if (data.total === 0) return <span className="text-sx-gray">0</span>

  return (
    <span className="flex items-center justify-end gap-1">
      {data.chips.map((game) => (
        <span
          key={game}
          title={game}
          className="max-w-14 truncate rounded border border-sx-border bg-sx-bg px-1.5 py-0.5 text-[10px] font-bold uppercase text-sx-gray"
        >
          {game}
        </span>
      ))}
      {data.overflow > 0 && (
        <span className="text-[10px] font-bold text-sx-gray">+{data.overflow}</span>
      )}
      <span className="ml-1 text-xs font-semibold text-white">{data.total}</span>
    </span>
  )
}
