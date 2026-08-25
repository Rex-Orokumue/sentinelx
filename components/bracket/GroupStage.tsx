'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { StandingRow } from '@/lib/tournaments/standings'
import { groupFixturesByDate, type BracketMatch, type FixtureDateGroup } from '@/lib/tournaments/bracket'
import type { FixtureContacts } from '@/lib/matches/admin-whatsapp'
import { StandingsTable } from './StandingsTable'
import { MatchCard } from './MatchCard'

type Buckets = {
  live: BracketMatch[]
  upcoming: BracketMatch[]
  completed: BracketMatch[]
  disputedOrCancelled: BracketMatch[]
}

export function GroupStage({
  standings,
  fixtures,
  contacts,
  tournamentId,
  groups,
}: {
  standings: { groupId: string; groupName: string; rows: StandingRow[] }[]
  fixtures: Buckets
  // Admin-only: matchId -> each player's wa.me link. The public bracket page
  // omits it, so no player numbers reach the public bundle.
  contacts?: FixtureContacts
  // Admin-only, and only set while the bracket is staff-preview (pre-publish):
  // presence of `groups` turns on the per-player "move to another group"
  // control in the standings table. The public bracket page passes neither.
  tournamentId?: string
  groups?: { id: string; name: string }[]
}) {
  const [tab, setTab] = useState<'table' | 'fixtures'>('table')
  const [showCompleted, setShowCompleted] = useState(false)

  const totalFixtures =
    fixtures.live.length +
    fixtures.upcoming.length +
    fixtures.completed.length +
    fixtures.disputedOrCancelled.length

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-white">Group Stage</h2>
        <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
          <TabButton active={tab === 'table'} onClick={() => setTab('table')}>Table</TabButton>
          <TabButton active={tab === 'fixtures'} onClick={() => setTab('fixtures')}>Fixtures</TabButton>
        </div>
      </div>

      {tab === 'table' ? (
        standings.map((g) => (
          <StandingsTable
            key={g.groupId}
            groupName={g.groupName}
            rows={g.rows}
            tournamentId={tournamentId}
            currentGroupId={g.groupId}
            groups={groups}
          />
        ))
      ) : totalFixtures === 0 ? (
        <p className="text-sm text-slate-500">No group fixtures scheduled yet.</p>
      ) : (
        <div className="space-y-6">
          {fixtures.live.length > 0 && (
            <FixtureGroup title="🔴 Live">
              {fixtures.live.map((m) => <MatchCard key={m.id} match={m} showGroup contact={contacts?.[m.id]} />)}
            </FixtureGroup>
          )}
          {groupFixturesByDate(fixtures.upcoming).map((g: FixtureDateGroup) => (
            <FixtureGroup key={g.dateLabel} title={`⏳ ${g.dateLabel}`}>
              {g.matches.map((m) => <MatchCard key={m.id} match={m} showGroup contact={contacts?.[m.id]} />)}
            </FixtureGroup>
          ))}
          {fixtures.completed.length > 0 && (
            <div>
              <button
                onClick={() => setShowCompleted((v) => !v)}
                className="mb-3 text-sm font-bold text-slate-300 transition-colors hover:text-white"
              >
                🏁 Completed ({fixtures.completed.length}) — {showCompleted ? 'Hide' : 'Show results'}
              </button>
              {showCompleted && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {fixtures.completed.map((m) => <MatchCard key={m.id} match={m} showGroup contact={contacts?.[m.id]} />)}
                </div>
              )}
            </div>
          )}
          {fixtures.disputedOrCancelled.length > 0 && (
            <FixtureGroup title="🚫 Disputed / Cancelled">
              {fixtures.disputedOrCancelled.map((m) => <MatchCard key={m.id} match={m} showGroup contact={contacts?.[m.id]} />)}
            </FixtureGroup>
          )}
        </div>
      )}
    </section>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
        active ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function FixtureGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-bold text-white">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}
