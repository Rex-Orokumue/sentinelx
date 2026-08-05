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
    <div className="rounded-xl border border-sx-border bg-sx-surface py-12 text-center">
      <p className="text-3xl">{icon}</p>
      <p className="mt-3 font-bold text-white">{title}</p>
      <p className="mt-1 text-sm text-sx-gray">{body}</p>
    </div>
  )
}
