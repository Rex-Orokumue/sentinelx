import type { Metadata } from 'next'
import Link from 'next/link'
import { resolveComingSoon } from '@/lib/nav/coming-soon'

type SearchParams = { feature?: string }

export function generateMetadata({ searchParams }: { searchParams: SearchParams }): Metadata {
  const f = resolveComingSoon(searchParams.feature)
  return { title: `${f.title} — SentinelX Esports` }
}

export default function ComingSoonPage({ searchParams }: { searchParams: SearchParams }) {
  const f = resolveComingSoon(searchParams.feature)
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <span className="font-display text-2xl font-bold uppercase tracking-wide text-white">
        Sentinel<span className="text-violet-400">X</span>
      </span>
      <h1 className="mt-6 text-3xl font-black text-white">{f.title}</h1>
      <p className="mt-3 text-sm text-slate-400">{f.blurb}</p>
      <Link
        href="/tournaments"
        className="mt-8 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-500"
      >
        Back to Compete
      </Link>
    </div>
  )
}
