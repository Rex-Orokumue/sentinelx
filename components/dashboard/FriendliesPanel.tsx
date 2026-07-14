import Link from 'next/link'

export function FriendliesPanel({
  pendingCount,
  activeCount,
  completedCount,
}: {
  pendingCount: number
  activeCount: number
  completedCount: number
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-sm text-slate-300">
        {pendingCount} pending · {activeCount} active · {completedCount} completed
      </p>
      <Link
        href="/dashboard/friendlies"
        className="mt-3 inline-block rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
      >
        View friendlies →
      </Link>
    </div>
  )
}
