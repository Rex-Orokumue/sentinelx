import type { SeasonLeaderboardRow } from '@/lib/seasons/data'

export function SeasonLeaderboardTable({
  rows,
  currentUserId,
}: {
  rows: SeasonLeaderboardRow[]
  currentUserId: string | null
}) {
  const top = rows.slice(0, 50)
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">Season Leaderboard</h2>
      <div className="overflow-x-auto rounded-2xl border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3 text-right">Season Points</th>
            </tr>
          </thead>
          <tbody>
            {top.map((row, i) => {
              const isMe = currentUserId != null && row.playerId === currentUserId
              return (
                <tr key={row.playerId} className={`border-b border-slate-900 last:border-0 ${isMe ? 'bg-violet-500/10' : ''}`}>
                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3 font-semibold text-white">{row.displayName ?? row.username ?? 'Player'}</td>
                  <td className="px-4 py-3 text-right font-bold text-violet-400">{row.points}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {top.length === 0 && <p className="p-4 text-sm text-slate-500">No season points awarded yet.</p>}
      </div>
      <p className="mt-3 text-xs text-slate-500">Qualify for Champions Cup — top 16 at season end earn an invitation.</p>
    </section>
  )
}
