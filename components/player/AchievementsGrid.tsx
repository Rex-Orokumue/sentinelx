import { Medal } from 'lucide-react'
import type { AchievementCell } from '@/lib/players/achievement-rarity'

export function AchievementsGrid({ achievements }: { achievements: AchievementCell[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">Trophies &amp; Badges</h2>
        <span className="text-xs text-sx-gray">
          {achievements.filter((a) => a.unlocked).length}/{achievements.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {achievements.map((a) => (
          <div
            key={a.slug}
            title={a.unlocked ? a.description : undefined}
            className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center ${
              a.unlocked ? 'border-sx-purple/40 bg-sx-surface' : 'border-sx-border bg-sx-surface opacity-40'
            }`}
          >
            {a.unlocked ? (
              <>
                <Medal className="h-8 w-8 text-sx-purple-text" />
                <p className="text-xs font-semibold text-white">{a.name}</p>
              </>
            ) : (
              <>
                <span className="text-2xl text-sx-gray">🔒</span>
                <p className="text-xs font-semibold text-sx-gray">Locked</p>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
