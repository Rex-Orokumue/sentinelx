export function LoginStreakBadge({ streak }: { streak: number }) {
  if (streak <= 0) return null
  return <span className="text-xs font-semibold text-amber-400">🔥 {streak}-day streak</span>
}
