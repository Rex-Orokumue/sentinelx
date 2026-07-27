import type { StandingRow } from '@/lib/tournaments/standings'

export function StandingsTable({ groupName, rows }: { groupName: string; rows: StandingRow[] }) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-sm font-bold text-white">{groupName}</h3>
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-500">
              <th className="whitespace-nowrap px-3 py-2.5 text-left">#</th>
              <th className="whitespace-nowrap px-2 py-2.5 text-left">Player</th>
              <th className="whitespace-nowrap px-2 py-2.5 text-center">P</th>
              <th className="whitespace-nowrap px-2 py-2.5 text-center">W</th>
              <th className="whitespace-nowrap px-2 py-2.5 text-center">D</th>
              <th className="whitespace-nowrap px-2 py-2.5 text-center">L</th>
              <th className="whitespace-nowrap px-2 py-2.5 text-center">GF</th>
              <th className="whitespace-nowrap px-2 py-2.5 text-center">GA</th>
              <th className="whitespace-nowrap px-2 py-2.5 text-center">GD</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.playerId}
                className={`border-b border-slate-800/50 last:border-0 ${r.advancing ? 'bg-emerald-500/[0.06]' : ''}`}
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-bold text-slate-400">{r.advancing ? '✅' : r.rank}</td>
                <td className="whitespace-nowrap px-2 py-2.5 font-semibold text-white">{r.name}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-center text-slate-400">{r.played}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-center text-slate-400">{r.wins}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-center text-slate-400">{r.draws}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-center text-slate-400">{r.losses}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-center text-slate-400">{r.goalsFor}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-center text-slate-400">{r.goalsAgainst}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-center text-slate-400">
                  {r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold text-white">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
