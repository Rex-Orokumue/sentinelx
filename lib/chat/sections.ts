import type { createAdminClient } from '@/lib/supabase/admin'
import { formatNaira } from '@/lib/format'
import { isMySide, myMatchesFilter } from '@/lib/matches/sides'
import { sanitizeLabel } from './text-safety'

type Admin = ReturnType<typeof createAdminClient>
export const SECTIONS = ['matches', 'registrations', 'wallet', 'withdrawals', 'kyc', 'friendlies', 'score', 'notifications'] as const
export type Section = (typeof SECTIONS)[number]

export function parseSections(args: unknown): Section[] {
  const raw = (args as { sections?: unknown } | null)?.sections
  if (!Array.isArray(raw)) return []
  const out: Section[] = []
  for (const s of raw) {
    if (typeof s === 'string' && (SECTIONS as readonly string[]).includes(s) && !out.includes(s as Section)) out.push(s as Section)
    if (out.length >= SECTIONS.length) break
  }
  return out
}

export function unionSections(toolCallArgs: string[]): Section[] {
  const out: Section[] = []
  for (const a of toolCallArgs) {
    let parsed: unknown
    try { parsed = JSON.parse(a) } catch { continue }
    for (const s of parseSections(parsed)) if (!out.includes(s)) out.push(s)
  }
  return out
}

type Embed<T> = T | T[] | null | undefined
const one = <T,>(e: Embed<T>): T | null => (Array.isArray(e) ? (e[0] ?? null) : (e ?? null))
type MatchRow = {
  status: string; scheduled_at: string | null
  player_a_id: string | null; player_b_id: string | null; team_a_id?: string | null; team_b_id?: string | null
  player_a: Embed<{ username: string | null }>; player_b: Embed<{ username: string | null }>
  team_a?: Embed<{ name: string }>; team_b?: Embed<{ name: string }>
  tournament: Embed<{ title: string }>
}
type FriendlyRow = {
  challenger_id: string; opponent_id: string; status: string; stake_amount: number | null
  challenger: Embed<{ username: string | null }>; opponent: Embed<{ username: string | null }>
}

const loaders: Record<Section, (admin: Admin, userId: string) => Promise<unknown>> = {
  matches: async (admin, id) => {
    const { data: sq } = await admin.from('squad_members').select('squad_id').eq('player_id', id)
    const squadIds = (sq ?? []).map((r) => r.squad_id as string)
    const { data, error } = await admin
      .from('matches')
      .select(
        'status, scheduled_at, player_a_id, player_b_id, team_a_id, team_b_id, ' +
          'player_a:profiles!matches_player_a_id_fkey(username), player_b:profiles!matches_player_b_id_fkey(username), ' +
          'team_a:squads!matches_team_a_id_fkey(name), team_b:squads!matches_team_b_id_fkey(name), tournament:tournaments(title)',
      )
      .or(myMatchesFilter(id, squadIds))
      .in('status', ['scheduled', 'live'])
    if (error) return null
    return ((data ?? []) as unknown as MatchRow[]).map((m) => {
      const ids = { player_a_id: m.player_a_id, player_b_id: m.player_b_id, team_a_id: m.team_a_id ?? null, team_b_id: m.team_b_id ?? null }
      const oppIsA = isMySide(ids, id, squadIds) === 'b'
      const team = one(oppIsA ? m.team_a : m.team_b)
      const player = one(oppIsA ? m.player_a : m.player_b)
      return {
        opponent: team ? sanitizeLabel(team.name) : sanitizeLabel(player?.username) || 'opponent',
        scheduledAt: m.scheduled_at,
        tournament: sanitizeLabel(one(m.tournament)?.title, 80) || 'Tournament',
        status: m.status,
      }
    })
  },
  registrations: async (admin, id) => {
    const { data, error } = await admin
      .from('tournament_registrations')
      .select('status, payment_status, tournament:tournaments(title)')
      .eq('player_id', id)
      .order('registered_at', { ascending: false })
      .limit(10)
    if (error) return null
    return ((data ?? []) as unknown as Array<{ status: string; payment_status: string; tournament: Embed<{ title: string }> }>).map((r) => ({
      tournament: sanitizeLabel(one(r.tournament)?.title, 80) || 'Tournament',
      status: r.status,
      paymentStatus: r.payment_status,
    }))
  },
  wallet: async (admin, id) => {
    const [w, c] = await Promise.all([
      admin.from('wallets').select('balance').eq('player_id', id).maybeSingle(),
      admin.from('sx_coins').select('balance').eq('player_id', id).maybeSingle(),
    ])
    if (w.error || c.error) return null
    return { balanceNaira: formatNaira(w.data?.balance ?? 0), coins: c.data?.balance ?? 0 }
  },
  withdrawals: async (admin, id) => {
    const { data, error } = await admin
      .from('withdrawal_requests')
      .select('amount, status, requested_at')
      .eq('player_id', id)
      .order('requested_at', { ascending: false })
      .limit(5)
    if (error) return null
    return ((data ?? []) as Array<{ amount: number; status: string; requested_at: string }>).map((w) => ({
      amountNaira: formatNaira(w.amount),
      status: w.status,
      date: w.requested_at.slice(0, 10),
    }))
  },
  kyc: async (admin, id) => {
    const { data, error } = await admin.from('player_kyc').select('kyc_status').eq('player_id', id).maybeSingle()
    return error ? null : { status: data?.kyc_status ?? 'not_started' }
  },
  friendlies: async (admin, id) => {
    const { data, error } = await admin
      .from('friendly_matches')
      .select(
        'challenger_id, opponent_id, status, stake_amount, ' +
          'challenger:profiles!friendly_matches_challenger_id_fkey(username), opponent:profiles!friendly_matches_opponent_id_fkey(username)',
      )
      .or(`challenger_id.eq.${id},opponent_id.eq.${id}`)
      .in('status', ['pending', 'awaiting_payment', 'active', 'awaiting_admin_confirmation'])
    if (error) return null
    return ((data ?? []) as unknown as FriendlyRow[]).map((f) => ({
      opponent: sanitizeLabel(one(f.challenger_id === id ? f.opponent : f.challenger)?.username) || 'opponent',
      status: f.status,
      stakeNaira: f.stake_amount != null ? formatNaira(f.stake_amount) : null,
    }))
  },
  score: async (admin, id) => {
    const { data, error } = await admin.from('profiles').select('sx_score, sentinel_tier, membership_tier').eq('id', id).maybeSingle()
    if (error) return null
    return { sxScore: data?.sx_score ?? 700, tier: data?.sentinel_tier ?? null, membership: data?.membership_tier ?? 'rookie' }
  },
  notifications: async (admin, id) => {
    const { count, error } = await admin
      .from('player_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', id)
      .eq('read', false)
    return error ? null : { unread: count ?? 0 }
  },
}

// The user id comes from the session, never from the model; only the requested sections are queried and a
// failing section degrades to null without failing the others.
export async function getAccountInfo(admin: Admin, userId: string, sections: Section[]): Promise<Record<string, unknown>> {
  const entries = await Promise.all(sections.map(async (s) => {
    try { return [s, await loaders[s](admin, userId)] as const } catch { return [s, null] as const }
  }))
  return Object.fromEntries(entries)
}
