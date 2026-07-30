'use client'
import { useState } from 'react'
import type { BracketView } from '@/lib/tournaments/bracket-view'
import type { FixtureContacts } from '@/lib/matches/admin-whatsapp'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'
import { GroupStage } from '@/components/bracket/GroupStage'
import { BracketTree } from '@/components/bracket/BracketTree'

export function AdminBracketView({
  standings,
  fixtures,
  rounds,
  projected,
  champion,
  hasGroups,
  contacts,
}: Pick<BracketView, 'standings' | 'fixtures' | 'rounds' | 'projected' | 'champion' | 'hasGroups'> & {
  contacts: FixtureContacts
}) {
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
      {hasGroups && <GroupStage standings={filteredStandings} fixtures={fixtures} contacts={contacts} />}
      <BracketTree rounds={rounds} projected={projected} champion={champion} />
    </>
  )
}
