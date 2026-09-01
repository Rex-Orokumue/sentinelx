import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { loadBracketView } from '@/lib/tournaments/bracket-view'
import {
  computePendingKnockoutRound,
  computeRearrangeableKnockoutRound,
} from '@/lib/tournaments/knockout-pairing'
import { buildFixtureContactMap } from '@/lib/matches/admin-whatsapp'
import { BracketActions } from '@/components/admin/BracketActions'
import { AdminBracketView } from '@/components/admin/AdminBracketView'
import { RecomputeStandingsButton } from '@/components/admin/RecomputeStandingsButton'

export const metadata: Metadata = { title: 'Bracket · Admin · SentinelX' }

export default async function AdminBracketPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title, status, round_start_date, round_gap_days, format, manual_knockout_pairing')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const view = await loadBracketView(supabase, t.id, t.format)

  const groupStageDone =
    view.hasGroups &&
    view.fixtures.completed.length > 0 &&
    view.fixtures.live.length === 0 &&
    view.fixtures.upcoming.length === 0 &&
    view.fixtures.disputedOrCancelled.length === 0

  const pendingRound = t.manual_knockout_pairing
    ? computePendingKnockoutRound({
        manualPairingEnabled: true,
        hasGroups: view.hasGroups,
        groupStageComplete: groupStageDone,
        standings: view.standings.map((g) => ({
          groupName: g.groupName,
          rows: g.rows.map((r) => ({ playerId: r.playerId, name: r.name, advancing: r.advancing })),
        })),
        knockoutRounds: view.rounds.map((r) => ({ round: r.round, matches: r.matches })),
      })
    : null

  const rearrangeableRound = computeRearrangeableKnockoutRound({
    knockoutRounds: view.rounds.map((r) => ({ round: r.round, matches: r.matches })),
  })
  const { count: paidCount } = await supabase
    .from('tournament_registrations')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', t.id)
    .eq('payment_status', 'paid')

  // Contact links for the Fixtures tab, so a stalling group match can be chased
  // from the same screen it's spotted on. Built here rather than in
  // loadBracketView — that loader is shared with the PUBLIC bracket page, which
  // must never receive player phone numbers.
  const groupFixtures = [
    ...view.fixtures.live,
    ...view.fixtures.upcoming,
    ...view.fixtures.completed,
    ...view.fixtures.disputedOrCancelled,
  ]
  const fixturePlayerIds = Array.from(
    new Set(groupFixtures.flatMap((f) => [f.playerA.id, f.playerB.id]).filter(Boolean)),
  )
  const [{ data: regWhatsappRows }, { data: profileWhatsappRowsRaw }] = await Promise.all([
    fixturePlayerIds.length > 0
      ? supabase
          .from('tournament_registrations')
          .select('player_id, reg_whatsapp')
          .eq('tournament_id', t.id)
      : Promise.resolve({ data: [] as { player_id: string; reg_whatsapp: string | null }[] }),
    fixturePlayerIds.length > 0
      ? supabase.from('profiles').select('id, whatsapp_number, country').in('id', fixturePlayerIds)
      : Promise.resolve({
          data: [] as { id: string; whatsapp_number: string | null; country: string | null }[],
        }),
  ])
  const profileRows = profileWhatsappRowsRaw as
    | { id: string; whatsapp_number: string | null; country: string | null }[]
    | null
  const contacts = buildFixtureContactMap({
    fixtures: groupFixtures,
    tournamentTitle: t.title,
    regWhatsappByPlayer: new Map(
      ((regWhatsappRows as { player_id: string; reg_whatsapp: string | null }[] | null) ?? []).map(
        (r) => [r.player_id, r.reg_whatsapp],
      ),
    ),
    profileWhatsappByPlayer: new Map(
      (profileRows ?? []).map((p) => [p.id, p.whatsapp_number]),
    ),
    // Non-Nigerian players type their number in their own national format.
    countryByPlayer: new Map((profileRows ?? []).map((p) => [p.id, p.country])),
  })

  return (
    <section>
      <div className="flex items-center justify-between">
        <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
          ← Tournaments
        </Link>
        <Link
          href={`/admin/tournaments/${t.id}/matches`}
          className="text-sm text-violet-400 hover:text-violet-300"
        >
          Manage matches →
        </Link>
      </div>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">
        {t.title} · <span className="text-slate-400">{t.status.replace(/_/g, ' ')}</span>
      </h2>

      <BracketActions
        tournamentId={t.id}
        status={t.status}
        paidCount={paidCount ?? 0}
        roundStartDate={t.round_start_date}
        roundGapDays={t.round_gap_days}
      />

      {view.hasGroups && (
        <div className="mb-4">
          <RecomputeStandingsButton tournamentId={t.id} />
        </div>
      )}

      {!view.hasGroups && !view.hasKnockout ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No bracket yet. Close registration to generate one.
        </p>
      ) : (
        <AdminBracketView
          tournamentId={t.id}
          status={t.status}
          standings={view.standings}
          fixtures={view.fixtures}
          rounds={view.rounds}
          projected={view.projected}
          champion={view.champion}
          thirdPlaceMatch={view.thirdPlaceMatch}
          hasGroups={view.hasGroups}
          contacts={contacts}
          pendingRound={pendingRound}
          rearrangeableRound={rearrangeableRound}
        />
      )}
    </section>
  )
}
