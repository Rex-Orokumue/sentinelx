'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaff } from '@/lib/admin/auth'
import { groupCountFor, snakeDistribute, roundRobinPairs, knockoutRound1 } from './draw'

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
  // Groups cascade to memberships + group matches; then remove knockout matches.
  await admin.from('groups').delete().eq('tournament_id', tournamentId)
  await admin.from('matches').delete().eq('tournament_id', tournamentId).is('group_id', null)
}

async function generate(admin: Admin, tournamentId: string, seeded: string[]): Promise<void> {
  await clearBracket(admin, tournamentId)
  const g = groupCountFor(seeded.length)

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
      })),
      ...byePlayerIds.map((pid) => ({
        tournament_id: tournamentId,
        round,
        group_id: null,
        player_a_id: pid,
        player_b_id: null,
        status: 'bye',
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
        })),
      )
    }
  }
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

  await admin.from('tournaments').update({ status: 'registration_closed' }).eq('id', id)
  await generate(admin, id, seeded)
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

  await generate(admin, id, seeded)
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
