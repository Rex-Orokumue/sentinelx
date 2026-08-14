import { Medal } from 'lucide-react'

export interface RecentAchievement {
  name: string
  unlockedAt: string
}

export function RecentAchievements({ achievements }: { achievements: RecentAchievement[] }) {
  if (achievements.length === 0) return null
  return (
    <div className="space-y-2">
      {achievements.map((a) => (
        <div key={a.name} className="flex items-center gap-2 text-xs text-sx-gray">
          <Medal className="h-4 w-4 text-sx-purple-text" /> {a.name}
        </div>
      ))}
    </div>
  )
}
