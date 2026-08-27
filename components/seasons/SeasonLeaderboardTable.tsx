import type { SeasonLeaderboardRow } from '@/lib/seasons/data'

export function SeasonLeaderboardTable({
  rows,
  currentUserId,
  qualificationNote,
}: {
  rows: SeasonLeaderboardRow[]
  currentUserId: string | null
  qualificationNote: string
}) {
  const top = rows.slice(0, 50)
  return (
    <section className="mb-10">
      <p className="mb-4 text-xs font-bold uppercase tracking-widest text-sx-purple-text">Season Leaderboard</p>
      <div className="overflow-x-auto rounded-xl border border-sx-border bg-sx-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sx-border text-left text-[11px] uppercase tracking-widest text-sx-gray">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3 text-right">Season Points</th>
            </tr>
          </thead>
          <tbody>
            {top.map((row, i) => {
              const isMe = currentUserId != null && row.playerId === currentUserId
              return (
                <tr
                  key={row.playerId}
                  className={`border-b border-sx-border/60 last:border-0 ${
                    isMe ? 'border-l-2 border-l-sx-purple bg-sx-purple/10' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-bold text-sx-gray">
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </td>
                  <td className="px-4 py-3 font-semibold text-white">
                    {row.displayName ?? row.username ?? 'Player'}
                    {isMe && <span className="ml-1 text-[11px] text-sx-purple-text">(you)</span>}
                    {row.isProvisional && (
                      <span
                        title="Still competing — this total can still change"
                        className="ml-1.5 rounded-full bg-sx-green/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sx-green"
                      >
                        Live
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-sx-purple-text">{row.points}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {top.length === 0 && <p className="p-4 text-sm text-sx-gray">No season points awarded yet.</p>}
      </div>
      <p className="mt-3 text-xs text-sx-gray">{qualificationNote}</p>
    </section>
  )
}
