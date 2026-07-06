import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sortStandings, type MembershipInput } from '@/lib/tournaments/standings'
import {
  splitFixturesByState,
  orderKnockoutRounds,
  getChampion,
  type BracketMatch,
} from '@/lib/tournaments/bracket'
import { GroupStage } from '@/components/bracket/GroupStage'
import { KnockoutBracket } from '@/components/bracket/KnockoutBracket'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

type ProfileRef = { id?: string; username: string | null; display_name: string | null } | null

function nameOf(p: ProfileRef): string {
  return p?.display_name ?? p?.username ?? 'TBD'
}

async function getTournament(slug: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('tournaments')
    .select('id, title, slug, status')
    .eq('slug', slug)
    .maybeSingle()
  if (!data || data.status === 'draft') return null
  return data
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const t = await getTournament(params.slug)
  if (!t) return { title: 'Bracket — Sentinel X' }
  const title = `Bracket — ${t.title} | Sentinel X`
  const description = `Group standings and knockout bracket for ${t.title} on Sentinel X.`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/tournaments/${t.slug}/bracket`,
      siteName: 'Sentinel X',
      type: 'website',
    },
  }
}

export default async function BracketPage({ params }: { params: { slug: string } }) {
  const t = await getTournament(params.slug)
  if (!t) notFound()

  const supabase = createClient()
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name')
    .eq('tournament_id', t.id)
    .order('name')

  const groupIds = (groups ?? []).map((g) => g.id)
  const groupNameById = new Map((groups ?? []).map((g) => [g.id, g.name]))

  const [membershipsRes, matchesRes] = await Promise.all([
    groupIds.length > 0
      ? supabase
          .from('group_memberships')
          .select(
            'group_id, player_id, wins, draws, losses, goals_for, goals_against, points, profiles(username, display_name)',
          )
          .in('group_id', groupIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase
      .from('matches')
      .select(
        'id, round, group_id, status, score_a, score_b, scheduled_at, ' +
          'player_a:profiles!matches_player_a_id_fkey(id, username, display_name), ' +
          'player_b:profiles!matches_player_b_id_fkey(id, username, display_name)',
      )
      .eq('tournament_id', t.id),
  ])

  // Normalize matches into BracketMatch[] once.
  const allMatches: BracketMatch[] = ((matchesRes.data as unknown[] | null) ?? []).map((raw) => {
    const m = raw as {
      id: string
      round: string
      group_id: string | null
      status: string
      score_a: number | null
      score_b: number | null
      scheduled_at: string | null
      player_a: ProfileRef
      player_b: ProfileRef
    }
    return {
      id: m.id,
      round: m.round,
      group_id: m.group_id,
      groupName: m.group_id ? groupNameById.get(m.group_id) ?? null : null,
      status: m.status,
      score_a: m.score_a,
      score_b: m.score_b,
      scheduled_at: m.scheduled_at,
      playerA: { id: m.player_a?.id ?? '', name: nameOf(m.player_a) },
      playerB: { id: m.player_b?.id ?? '', name: nameOf(m.player_b) },
    }
  })

  // Standings per group.
  const standings = (groups ?? []).map((g) => {
    const rows = ((membershipsRes.data as unknown[] | null) ?? [])
      .filter((raw) => (raw as { group_id: string }).group_id === g.id)
      .map((raw): MembershipInput => {
        const gm = raw as {
          player_id: string
          wins: number
          draws: number
          losses: number
          goals_for: number
          goals_against: number
          points: number
          profiles: ProfileRef
        }
        return {
          playerId: gm.player_id,
          name: nameOf(gm.profiles),
          wins: gm.wins,
          draws: gm.draws,
          losses: gm.losses,
          goalsFor: gm.goals_for,
          goalsAgainst: gm.goals_against,
          points: gm.points,
        }
      })
    return { groupName: g.name, rows: sortStandings(rows) }
  })

  const groupMatches = allMatches.filter((m) => m.group_id != null)
  const knockoutMatches = allMatches.filter((m) => m.round !== 'group')
  const fixtures = splitFixturesByState(groupMatches)
  const rounds = orderKnockoutRounds(knockoutMatches)
  const champion = getChampion(allMatches)

  const hasGroups = (groups ?? []).length > 0
  const hasKnockout = rounds.length > 0
  const isEmpty = !hasGroups && !hasKnockout

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <Link
        href={`/tournaments/${t.slug}`}
        className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
      >
        ← {t.title}
      </Link>
      <h1 className="mb-6 text-2xl font-black text-white">Bracket</h1>

      {champion && (
        <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400/80">Champion</p>
          <p className="mt-1 text-xl font-black text-white">🏆 {champion.name}</p>
        </div>
      )}

      {isEmpty ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 py-12 text-center">
          <p className="text-3xl">🗂️</p>
          <p className="mt-3 font-bold text-white">Bracket not published yet</p>
          <p className="mt-1 text-sm text-slate-500">
            It&apos;ll appear here once registration closes and the admin sets it up.
          </p>
        </div>
      ) : (
        <>
          {hasGroups && <GroupStage standings={standings} fixtures={fixtures} />}
          {hasKnockout && <KnockoutBracket rounds={rounds} />}
        </>
      )}
    </div>
  )
}
