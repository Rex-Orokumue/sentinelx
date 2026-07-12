'use client'
import { useState } from 'react'
import type { BracketView } from '@/lib/tournaments/bracket-view'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'
import { GroupStage } from '@/components/bracket/GroupStage'
import { KnockoutBracket } from '@/components/bracket/KnockoutBracket'

export function AdminBracketView({
  standings,
  fixtures,
  rounds,
  hasGroups,
  hasKnockout,
}: Pick<BracketView, 'standings' | 'fixtures' | 'rounds' | 'hasGroups' | 'hasKnockout'>) {
  const [query, setQuery] = useState('')
  const filteredStandings = standings.map((g) => ({
    groupName: g.groupName,
    rows: g.rows.filter((r) =>
      matchesPlayerQuery({ username: null, displayName: r.name, clubName: r.clubName ?? null }, query),
    ),
  }))

  return (
    <>
      {hasGroups && (
        <PlayerSearch value={query} onChange={setQuery} placeholder="Search players by name or club…" />
      )}
      {hasGroups && <GroupStage standings={filteredStandings} fixtures={fixtures} />}
      {hasKnockout && <KnockoutBracket rounds={rounds} />}
    </>
  )
}
