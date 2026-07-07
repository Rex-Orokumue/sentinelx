import Link from 'next/link'

export function StatCard({
  label,
  count,
  href,
}: {
  label: string
  count: number
  href?: string
}) {
  const cls = 'rounded-2xl border border-slate-800 bg-slate-900 p-5'
  const inner = (
    <>
      <p className="text-3xl font-black text-white">{count}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
    </>
  )
  if (href) {
    return (
      <Link href={href} className={`${cls} block transition-colors hover:border-slate-600`}>
        {inner}
      </Link>
    )
  }
  return <div className={cls}>{inner}</div>
}
