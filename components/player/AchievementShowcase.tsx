'use client'
import { useState } from 'react'
import { Medal } from 'lucide-react'
import { topShowcase, type AchievementCell } from '@/lib/players/achievement-rarity'
import { AchievementsGrid } from './AchievementsGrid'

export function AchievementShowcase({ achievements }: { achievements: AchievementCell[] }) {
  const [expanded, setExpanded] = useState(false)
  const unlockedCount = achievements.filter((a) => a.unlocked).length
  const top = topShowcase(achievements, 3)

  if (expanded) {
    return (
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white">
            Achievements ({unlockedCount} unlocked)
          </h2>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light"
          >
            Show less
          </button>
        </div>
        <AchievementsGrid achievements={achievements} />
      </section>
    )
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">
          Achievements ({unlockedCount} unlocked)
        </h2>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light"
        >
          View All →
        </button>
      </div>
      {top.length === 0 ? (
        <p className="text-sm text-sx-gray">No achievements unlocked yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {top.map((a) => (
            <div key={a.slug} className="flex items-start gap-3 rounded-xl border border-sx-purple/40 bg-sx-surface p-4">
              <Medal className="h-8 w-8 shrink-0 text-sx-purple-text" />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{a.name}</p>
                <p className="truncate text-xs text-sx-gray">{a.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
