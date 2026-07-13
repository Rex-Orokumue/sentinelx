'use client'
import { useState } from 'react'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'
import { AdminCommunityPostRow, type AdminCommunityPost } from './AdminCommunityPostRow'

export function AdminCommunityList({ posts }: { posts: AdminCommunityPost[] }) {
  const [query, setQuery] = useState('')
  const filtered = posts.filter((p) =>
    matchesPlayerQuery({ username: p.authorUsername, displayName: null }, query),
  )
  return (
    <div>
      <PlayerSearch value={query} onChange={setQuery} placeholder="Search by author username…" />
      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No posts match &quot;{query}&quot;.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <AdminCommunityPostRow key={p.id} post={p} />
          ))}
        </div>
      )}
    </div>
  )
}
