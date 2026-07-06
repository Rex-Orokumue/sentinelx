export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: string
  title: string
  body: string
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 py-12 text-center">
      <p className="text-3xl">{icon}</p>
      <p className="mt-3 font-bold text-white">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
    </div>
  )
}
