'use client'
import { useState } from 'react'
import type { BracketView } from '@/lib/tournaments/bracket-view'
import type { FixtureContacts } from '@/lib/matches/admin-whatsapp'
import { matchesPlayerQuery } from '@/lib/admin/search'
import type {
  PendingKnockoutRound,
  RearrangeableKnockoutRound,
} from '@/lib/tournaments/knockout-pairing'
import { PlayerSearch } from './PlayerSearch'
import { KnockoutPairingEditor } from './KnockoutPairingEditor'
import { GroupStage } from '@/components/bracket/GroupStage'
import { BracketTree } from '@/components/bracket/BracketTree'

export function AdminBracketView({
  tournamentId,
  status,
  entryUnit,
  standings,
  fixtures,
  rounds,
  projected,
  champion,
  thirdPlaceMatch,
  hasGroups,
  contacts,
  pendingRound,
  rearrangeableRound,
}: Pick<
  BracketView,
  'standings' | 'fixtures' | 'rounds' | 'projected' | 'champion' | 'thirdPlaceMatch' | 'hasGroups'
> & {
  tournamentId: string
  status: string
  entryUnit: string
  contacts: FixtureContacts
  pendingRound: PendingKnockoutRound | null
  rearrangeableRound: RearrangeableKnockoutRound | null
}) {
  const [query, setQuery] = useState('')
  const isTeam = entryUnit === 'squad'
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
        <PlayerSearch
          value={query}
          onChange={setQuery}
          placeholder={isTeam ? 'Search squads by name…' : 'Search players by name or club…'}
        />
      )}
      {hasGroups && (
        <GroupStage
          standings={filteredStandings}
          fixtures={fixtures}
          contacts={contacts}
          tournamentId={tournamentId}
          groups={editable ? groupOptions : undefined}
          entryUnit={entryUnit}
        />
      )}
      {pendingRound && (
        <div className="mb-4">
          <KnockoutPairingEditor
            mode="create"
            tournamentId={tournamentId}
            round={pendingRound.round}
            label={pendingRound.label}
            participants={pendingRound.participants}
            shape={pendingRound.shape}
            defaultAssignment={pendingRound.defaultAssignment}
            entryUnit={entryUnit}
          />
        </div>
      )}

      {!pendingRound && rearrangeableRound && (
        <details className="mb-4">
          <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-200">
            Rearrange the {rearrangeableRound.label} pairings
          </summary>
          <div className="mt-2">
            <KnockoutPairingEditor
              mode="rearrange"
              tournamentId={tournamentId}
              round={rearrangeableRound.round}
              label={rearrangeableRound.label}
              participants={rearrangeableRound.participants}
              shape={rearrangeableRound.shape}
              defaultAssignment={rearrangeableRound.currentAssignment}
              entryUnit={entryUnit}
            />
          </div>
        </details>
      )}

      <BracketTree rounds={rounds} projected={projected} champion={champion} thirdPlace={thirdPlaceMatch} />
    </>
  )
}
