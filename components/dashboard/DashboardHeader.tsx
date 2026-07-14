import { Avatar } from '@/components/shared/Avatar'

export function DashboardHeader({
  name,
  username,
  avatarUrl,
  wins,
  losses,
}: {
  name: string
  username: string | null
  avatarUrl: string | null
  wins: number
  losses: number
}) {
  return (
    <div className="flex items-center gap-4 py-8">
      <Avatar avatarUrl={avatarUrl} displayName={name} username={username} size={56} className="text-xl" />
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-black text-white">{name}</h1>
        <p className="mt-1 text-sm text-slate-400">
          <span className="font-bold text-emerald-400">{wins}</span> W ·{' '}
          <span className="font-bold text-red-400">{losses}</span> L
        </p>
      </div>
    </div>
  )
}
