'use client'
import { useState } from 'react'
import type { BracketView } from '@/lib/tournaments/bracket-view'
import type { FixtureContacts } from '@/lib/matches/admin-whatsapp'
import { matchesPlayerQuery } from '@/lib/admin/search'
import { PlayerSearch } from './PlayerSearch'
import { GroupStage } from '@/components/bracket/GroupStage'
import { BracketTree } from '@/components/bracket/BracketTree'

export function AdminBracketView({
  tournamentId,
  status,
  standings,
  fixtures,
  rounds,
  projected,
  champion,
  hasGroups,
  contacts,
}: Pick<BracketView, 'standings' | 'fixtures' | 'rounds' | 'projected' | 'champion' | 'hasGroups'> & {
  tournamentId: string
  status: string
  contacts: FixtureContacts
}) {
  const [query, setQuery] = useState('')
  const filteredStandings = standings.map((g) => ({
    groupId: g.groupId,
    groupName: g.groupName,
    rows: g.rows.filter((r) =>
      matchesPlayerQuery({ username: null, displayName: r.name, clubName: r.clubName ?? null }, query),
    ),
  }))
  // Groups can only be manually reassigned in the staff-only preview window,
  // same as re-rolling the draw and reopening registration — BracketActions.
  const editable = status === 'registration_closed'
  const groupOptions = standings.map((g) => ({ id: g.groupId, name: g.groupName }))

  return (
    <>
      {hasGroups && (
        <PlayerSearch value={query} onChange={setQuery} placeholder="Search players by name or club…" />
      )}
      {hasGroups && (
        <GroupStage
          standings={filteredStandings}
          fixtures={fixtures}
          contacts={contacts}
          tournamentId={tournamentId}
          groups={editable ? groupOptions : undefined}
        />
      )}
      <BracketTree rounds={rounds} projected={projected} champion={champion} />
    </>
  )
}
