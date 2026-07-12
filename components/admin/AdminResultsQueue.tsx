'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { ReviewMatchInput } from '@/lib/matches/review-queue'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'

function matchesEitherPlayer(m: ReviewMatchInput, query: string): boolean {
  return (
    matchesPlayerQuery({ username: null, displayName: m.playerAName, clubName: m.playerAClubName ?? null }, query) ||
    matchesPlayerQuery({ username: null, displayName: m.playerBName, clubName: m.playerBClubName ?? null }, query)
  )
}

export function AdminResultsQueue({
  needsReview,
  noSubmission,
  disputed,
}: {
  needsReview: ReviewMatchInput[]
  noSubmission: ReviewMatchInput[]
  disputed: ReviewMatchInput[]
}) {
  const [query, setQuery] = useState('')
  const filtered = {
    needsReview: needsReview.filter((m) => matchesEitherPlayer(m, query)),
    noSubmission: noSubmission.filter((m) => matchesEitherPlayer(m, query)),
    disputed: disputed.filter((m) => matchesEitherPlayer(m, query)),
  }
  const total = filtered.needsReview.length + filtered.noSubmission.length + filtered.disputed.length

  return (
    <div>
      <PlayerSearch value={query} onChange={setQuery} />
      {total === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          {query ? `No matches for "${query}".` : 'Nothing to review right now.'}
        </p>
      ) : (
        <div className="space-y-8">
          <Bucket title="Needs review" items={filtered.needsReview} />
          <Bucket title="No submission" items={filtered.noSubmission} />
          <Bucket title="Disputed" items={filtered.disputed} />
        </div>
      )}
    </div>
  )
}

function Bucket({ title, items }: { title: string; items: ReviewMatchInput[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {title} ({items.length})
      </h3>
      <div className="space-y-2">
        {items.map((m) => (
          <Link
            key={m.id}
            href={`/admin/matches/${m.id}/review`}
            className="block rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-600"
          >
            <p className="truncate font-bold text-white">
              {m.playerAName} <span className="text-slate-500">vs</span> {m.playerBName}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {m.tournamentTitle} · {m.round.replace(/_/g, ' ')}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
