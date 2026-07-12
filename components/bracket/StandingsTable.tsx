import type { StandingRow } from '@/lib/tournaments/standings'

export function StandingsTable({ groupName, rows }: { groupName: string; rows: StandingRow[] }) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-bold text-white">{groupName}</h3>
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
              <th className="px-3 py-2.5 text-left">#</th>
              <th className="px-2 py-2.5 text-left">Player</th>
              <th className="px-2 py-2.5 text-center">P</th>
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">W</th>
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">D</th>
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">L</th>
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">GF</th>
              <th className="hidden px-2 py-2.5 text-center sm:table-cell">GA</th>
              <th className="px-2 py-2.5 text-center">GD</th>
              <th className="px-3 py-2.5 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.playerId}
                className={`border-b border-slate-800/50 last:border-0 ${r.advancing ? 'bg-emerald-500/[0.06]' : ''}`}
              >
                <td className="px-3 py-2.5 font-bold text-slate-400">{r.advancing ? '✅' : r.rank}</td>
                <td className="px-2 py-2.5 font-semibold text-white">{r.name}</td>
                <td className="px-2 py-2.5 text-center text-slate-400">{r.played}</td>
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.wins}</td>
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.draws}</td>
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.losses}</td>
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.goalsFor}</td>
                <td className="hidden px-2 py-2.5 text-center text-slate-400 sm:table-cell">{r.goalsAgainst}</td>
                <td className="px-2 py-2.5 text-center text-slate-400">
                  {r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}
                </td>
                <td className="px-3 py-2.5 text-right font-bold text-white">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
