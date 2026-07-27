'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { resolveGroupCount, snakeDistribute, roundRobinPairs, knockoutRound1 } from './draw'
import { nextRoundScheduledAt } from './round-schedule'

export type BracketState = { error?: string; success?: boolean } | undefined

type Admin = ReturnType<typeof createAdminClient>

// Paid players ordered by sentinel_score desc, ties broken randomly.
async function seededPaidPlayers(admin: Admin, tournamentId: string): Promise<string[]> {
  const { data: regs } = await admin
    .from('tournament_registrations')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('payment_status', 'paid')
  const ids = (regs ?? []).map((r) => r.player_id)
  if (ids.length === 0) return []
  const { data: profs } = await admin.from('profiles').select('id, sentinel_score').in('id', ids)
  const scoreById = new Map((profs ?? []).map((p) => [p.id, p.sentinel_score]))
  return ids
    .map((id) => ({ id, score: scoreById.get(id) ?? 0, r: Math.random() }))
    .sort((a, b) => b.score - a.score || a.r - b.r)
    .map((x) => x.id)
}

async function clearBracket(admin: Admin, tournamentId: string): Promise<void> {
  // Matches must go first: matches.group_id has no ON DELETE CASCADE, so deleting
  // groups while matches still reference them fails the FK constraint. Deleting all
  // matches (group-stage and knockout) up front makes the groups delete safe — groups
  // cascade to group_memberships on their own.
  const { error: matchesErr } = await admin.from('matches').delete().eq('tournament_id', tournamentId)
  if (matchesErr) throw new Error(`Failed to clear existing matches: ${matchesErr.message}`)
  const { error: groupsErr } = await admin.from('groups').delete().eq('tournament_id', tournamentId)
  if (groupsErr) throw new Error(`Failed to clear existing groups: ${groupsErr.message}`)
}

async function generate(
  admin: Admin,
  tournamentId: string,
  seeded: string[],
  g: number,
): Promise<void> {
  await clearBracket(admin, tournamentId)
  const roundDate = await nextRoundScheduledAt(admin, tournamentId)
  const schedule = roundDate ? { scheduled_at: roundDate, is_full_day: true } : {}

  if (g === 0) {
    const { round, matches, byePlayerIds } = knockoutRound1(seeded)
    const rows = [
      ...matches.map(([a, b]) => ({
        tournament_id: tournamentId,
        round,
        group_id: null,
        player_a_id: a,
        player_b_id: b,
        status: 'scheduled',
        ...schedule,
      })),
      ...byePlayerIds.map((pid) => ({
        tournament_id: tournamentId,
        round,
        group_id: null,
        player_a_id: pid,
        player_b_id: null,
        status: 'bye',
        ...schedule,
      })),
    ]
    if (rows.length > 0) await admin.from('matches').insert(rows)
    return
  }

  const groups = snakeDistribute(seeded, g)
  for (let i = 0; i < groups.length; i++) {
    const { data: grp } = await admin
      .from('groups')
      .insert({ tournament_id: tournamentId, name: `Group ${String.fromCharCode(65 + i)}` })
      .select('id')
      .single()
    if (!grp) continue
    await admin
      .from('group_memberships')
      .insert(groups[i].map((pid) => ({ group_id: grp.id, player_id: pid })))
    const pairs = roundRobinPairs(groups[i])
    if (pairs.length > 0) {
      await admin.from('matches').insert(
        pairs.map(([a, b]) => ({
          tournament_id: tournamentId,
          round: 'group',
          group_id: grp.id,
          player_a_id: a,
          player_b_id: b,
          status: 'scheduled',
          ...schedule,
        })),
      )
    }
  }
}

function parseGroupsField(formData: FormData): number | undefined {
  const raw = formData.get('groups')
  if (typeof raw !== 'string' || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function parseRoundStartDate(formData: FormData): string | null {
  const raw = formData.get('roundStartDate')
  return typeof raw === 'string' && raw !== '' ? raw : null
}

function parseRoundGapDays(formData: FormData): number {
  const raw = formData.get('roundGapDays')
  const n = typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

function revalidateAdmin(tournamentId: string): void {
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  revalidatePath('/admin/tournaments')
}

export async function closeRegistration(
  _prev: BracketState,
  formData: FormData,
): Promise<BracketState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const { data: t } = await admin.from('tournaments').select('status').eq('id', id).maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_open') return { error: 'Registration is not open.' }

  const seeded = await seededPaidPlayers(admin, id)
  if (seeded.length < 2) return { error: 'Need at least 2 paid players to close registration.' }
  if (seeded.length > 64) return { error: 'At most 64 players are supported.' }

  const g = resolveGroupCount(parseGroupsField(formData), seeded.length)
  const roundStartDate = parseRoundStartDate(formData)
  const roundGapDays = parseRoundGapDays(formData)
  await admin
    .from('tournaments')
    .update({
      status: 'registration_closed',
      round_start_date: roundStartDate,
      round_gap_days: roundGapDays,
    })
    .eq('id', id)
  try {
    await generate(admin, id, seeded, g)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to generate the bracket.' }
  }
  revalidateAdmin(id)
  return { success: true }
}

export async function generateBracket(
  _prev: BracketState,
  formData: FormData,
): Promise<BracketState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const { data: t } = await admin.from('tournaments').select('status').eq('id', id).maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed') return { error: 'The bracket is locked.' }

  const seeded = await seededPaidPlayers(admin, id)
  if (seeded.length < 2) return { error: 'Need at least 2 paid players.' }
  if (seeded.length > 64) return { error: 'At most 64 players are supported.' }

  const g = resolveGroupCount(parseGroupsField(formData), seeded.length)
  const roundStartDate = parseRoundStartDate(formData)
  const roundGapDays = parseRoundGapDays(formData)
  await admin
    .from('tournaments')
    .update({ round_start_date: roundStartDate, round_gap_days: roundGapDays })
    .eq('id', id)
  try {
    await generate(admin, id, seeded, g)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to generate the bracket.' }
  }
  revalidateAdmin(id)
  return { success: true }
}

export async function publishBracket(
  _prev: BracketState,
  formData: FormData,
): Promise<BracketState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const admin = createAdminClient()
  const { data: t } = await admin
    .from('tournaments')
    .select('status, slug')
    .eq('id', id)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'registration_closed')
    return { error: 'Only a finalized bracket can be published.' }

  const { count } = await admin
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', id)
  if (!count) return { error: 'Generate a bracket before publishing.' }

  await admin.from('tournaments').update({ status: 'active' }).eq('id', id)
  revalidateAdmin(id)
  revalidatePath(`/tournaments/${t.slug}`)
  revalidatePath(`/tournaments/${t.slug}/bracket`)
  return { success: true }
}
