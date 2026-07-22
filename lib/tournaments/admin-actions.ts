'use server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, requireAdmin } from '@/lib/admin/auth'
import { tournamentSchema, type TournamentInput } from './admin-schema'
import { slugify } from './slug'
import { missingForPublish } from './readiness'
import { manualCreditWallet } from '@/lib/admin/wallet-actions'

export type TournamentFormState = { error?: string; success?: boolean } | undefined
export type PublishState = { error?: string; fieldErrors?: string[]; success?: boolean } | undefined

function parseForm(formData: FormData) {
  return tournamentSchema.safeParse({
    title: formData.get('title'),
    gameId: formData.get('gameId'),
    slug: formData.get('slug') ?? '',
    description: formData.get('description') ?? '',
    bannerUrl: formData.get('bannerUrl') ?? '',
    registrationFee: formData.get('registrationFee'),
    prizePool: formData.get('prizePool'),
    maxPlayers: formData.get('maxPlayers') ?? '',
    registrationStart: formData.get('registrationStart') ?? '',
    registrationEnd: formData.get('registrationEnd') ?? '',
    tournamentStart: formData.get('tournamentStart') ?? '',
    tournamentEnd: formData.get('tournamentEnd') ?? '',
    rules: formData.get('rules') ?? '',
    dataSupportText: formData.get('dataSupportText') ?? '',
    dataSupportWhatsapp: formData.get('dataSupportWhatsapp') ?? '',
  })
}

// Map validated form values onto the tournaments row columns (empty string -> null).
function toRow(d: TournamentInput) {
  const orNull = (v: string) => (v === '' ? null : v)
  return {
    title: d.title,
    game_id: d.gameId,
    description: orNull(d.description),
    banner_url: orNull(d.bannerUrl),
    registration_fee: d.registrationFee,
    prize_pool: d.prizePool,
    max_players: d.maxPlayers === '' ? null : d.maxPlayers,
    registration_start: orNull(d.registrationStart),
    registration_end: orNull(d.registrationEnd),
    tournament_start: orNull(d.tournamentStart),
    tournament_end: orNull(d.tournamentEnd),
    rules: orNull(d.rules),
    data_support_text: orNull(d.dataSupportText),
    data_support_whatsapp: orNull(d.dataSupportWhatsapp),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505'
}

export async function createTournament(
  _prev: TournamentFormState,
  formData: FormData,
): Promise<TournamentFormState> {
  await requireStaff()
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const base = slugify(parsed.data.slug || parsed.data.title)
  if (!base) return { error: 'Enter a title that produces a valid URL slug.' }

  const supabase = createClient()
  const row = { ...toRow(parsed.data), status: 'draft', format: 'group_knockout' }

  // Insert, retrying with a random suffix if the slug collides (23505).
  let slug = base
  let newId: string | null = null
  for (let i = 0; i < 5; i++) {
    const { data, error } = await supabase
      .from('tournaments')
      .insert({ ...row, slug })
      .select('id')
      .single()
    if (!error) {
      newId = data.id
      break
    }
    if (!isUniqueViolation(error)) return { error: 'Could not create the tournament. Please try again.' }
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
  }
  if (!newId) return { error: 'Could not generate a unique URL slug. Try a different title.' }

  revalidatePath('/admin/tournaments')
  revalidatePath('/tournaments')
  redirect(`/admin/tournaments/${newId}/edit`)
}

export async function updateTournament(
  _prev: TournamentFormState,
  formData: FormData,
): Promise<TournamentFormState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }
  const parsed = parseForm(formData)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { data: current } = await supabase
    .from('tournaments')
    .select('status, slug')
    .eq('id', id)
    .maybeSingle()
  if (!current) return { error: 'Tournament not found.' }

  // Slug is editable only while draft; otherwise keep the stored slug.
  let slug = current.slug
  if (current.status === 'draft') {
    const base = slugify(parsed.data.slug || parsed.data.title)
    if (!base) return { error: 'Enter a title that produces a valid URL slug.' }
    slug = base
  }

  const { error } = await supabase
    .from('tournaments')
    .update({ ...toRow(parsed.data), slug })
    .eq('id', id)
  if (error) {
    if (isUniqueViolation(error)) return { error: 'That URL slug is already taken.' }
    return { error: 'Could not save changes. Please try again.' }
  }

  revalidatePath('/admin/tournaments')
  revalidatePath('/tournaments')
  revalidatePath(`/tournaments/${slug}`)
  return { success: true }
}

export async function deleteTournament(
  _prev: TournamentFormState,
  formData: FormData,
): Promise<TournamentFormState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const supabase = createClient()
  const { data: current } = await supabase
    .from('tournaments')
    .select('status')
    .eq('id', id)
    .maybeSingle()
  if (!current) return { error: 'Tournament not found.' }
  // Server-side guard: the ON DELETE CASCADE is safe ONLY because deletion is
  // unreachable outside draft (no paid registrations / matches / results / SEO).
  if (current.status !== 'draft') return { error: 'Only draft tournaments can be deleted.' }

  const { error } = await supabase.from('tournaments').delete().eq('id', id)
  if (error) return { error: 'Could not delete the tournament.' }

  revalidatePath('/admin/tournaments')
  revalidatePath('/tournaments')
  return { success: true }
}

export async function openRegistration(
  _prev: PublishState,
  formData: FormData,
): Promise<PublishState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select(
      'status, game_id, max_players, registration_fee, prize_pool, registration_start, registration_end, tournament_start, tournament_end',
    )
    .eq('id', id)
    .maybeSingle()
  if (!t) return { error: 'Tournament not found.' }
  if (t.status !== 'draft')
    return { error: 'Registration can only be opened for a draft tournament.' }

  const missing = missingForPublish({
    gameId: t.game_id,
    maxPlayers: t.max_players,
    registrationFee: t.registration_fee,
    prizePool: t.prize_pool,
    dates: [t.registration_start, t.registration_end, t.tournament_start, t.tournament_end],
  })
  if (missing.length > 0) return { fieldErrors: missing }

  const { error } = await supabase
    .from('tournaments')
    .update({ status: 'registration_open' })
    .eq('id', id)
  if (error) return { error: 'Could not open registration.' }

  revalidatePath('/admin/tournaments')
  revalidatePath('/tournaments')
  return { success: true }
}

export async function cancelTournament(
  _prev: TournamentFormState,
  formData: FormData,
): Promise<TournamentFormState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing tournament.' }

  const supabase = createClient()
  const { data: current } = await supabase.from('tournaments').select('status').eq('id', id).maybeSingle()
  if (!current) return { error: 'Tournament not found.' }
  if (!['registration_open', 'registration_closed', 'active'].includes(current.status)) {
    return { error: 'Only a live or announced tournament can be cancelled.' }
  }

  const { error: cancelErr } = await supabase.from('tournaments').update({ status: 'cancelled' }).eq('id', id)
  if (cancelErr) return { error: 'Could not cancel the tournament.' }

  revalidatePath('/admin/tournaments')
  revalidatePath(`/admin/tournaments/${id}/registrations`)
  return { success: true }
}

export type RefundState = { error?: string; success?: boolean } | undefined

export async function refundRegistration(
  _prev: RefundState,
  formData: FormData,
): Promise<RefundState> {
  await requireAdmin()
  const registrationId = String(formData.get('registrationId') ?? '')
  const tournamentId = String(formData.get('tournamentId') ?? '')
  const playerId = String(formData.get('playerId') ?? '')
  const amount = Number(formData.get('amount'))
  const reason = String(formData.get('reason') ?? '')
  if (!registrationId || !playerId) return { error: 'Missing registration.' }
  if (!Number.isInteger(amount) || amount <= 0) return { error: 'Invalid refund amount.' }
  if (!reason.trim()) return { error: 'Missing refund reason.' }

  const supabase = createClient()

  // Atomic conditional update — same non-race pattern as waiver redemption.
  // If no row comes back, someone already refunded this registration.
  const { data: claimed } = await supabase
    .from('tournament_registrations')
    .update({ payment_status: 'refunded' })
    .eq('id', registrationId)
    .eq('payment_status', 'paid')
    .select('id')
  if (!claimed || claimed.length === 0) {
    return { error: 'This registration has already been refunded or is not paid.' }
  }

  const result = await manualCreditWallet(playerId, amount, reason.trim())
  if ('error' in result) {
    // Roll back the claim so the row is refundable again — a failed wallet
    // credit must never leave a registration marked refunded with no credit.
    await supabase.from('tournament_registrations').update({ payment_status: 'paid' }).eq('id', registrationId)
    return { error: `Refund could not be completed: ${result.error}` }
  }

  revalidatePath(`/admin/tournaments/${tournamentId}/registrations`)
  return { success: true }
}
