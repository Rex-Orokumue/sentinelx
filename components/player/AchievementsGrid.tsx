import { Medal } from 'lucide-react'

export interface AchievementCell {
  slug: string
  name: string
  description: string
  unlocked: boolean
}

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
            title={a.description}
            className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center ${
              a.unlocked ? 'border-sx-purple/40 bg-sx-surface' : 'border-sx-border bg-sx-surface opacity-50'
            }`}
          >
            <Medal className={`h-8 w-8 ${a.unlocked ? 'text-sx-purple-text' : 'text-sx-gray'}`} />
            <p className={`text-xs font-semibold ${a.unlocked ? 'text-white' : 'text-sx-gray'}`}>{a.name}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
