'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { matchEditSchema } from './edit-schema'

export type MatchAdminState = { error?: string; success?: boolean } | undefined

type SlugRef = { slug: string } | { slug: string }[] | null
type StatusSlugRef = { status: string; slug: string } | { status: string; slug: string }[] | null
function first<T>(x: T | T[] | null): T | null {
  return Array.isArray(x) ? x[0] ?? null : x
}

function revalidateMatch(matchId: string, tournamentId: string, slug: string | null): void {
  revalidatePath(`/admin/tournaments/${tournamentId}/matches`)
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  revalidatePath(`/matches/${matchId}`)
  if (slug) {
    revalidatePath(`/tournaments/${slug}`)
    revalidatePath(`/tournaments/${slug}/bracket`)
  }
}

export async function updateMatch(
  _prev: MatchAdminState,
  formData: FormData,
): Promise<MatchAdminState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match.' }

  const parsed = matchEditSchema.safeParse({
    scheduledAt: formData.get('scheduledAt') ?? '',
    streamUrl: formData.get('streamUrl') ?? '',
    replayUrl: formData.get('replayUrl') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const { data: m } = await supabase
    .from('matches')
    .select('id, tournament_id, tournament:tournaments(slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }

  const orNull = (v: string) => (v === '' ? null : v)
  const { error } = await supabase
    .from('matches')
    .update({
      scheduled_at: orNull(parsed.data.scheduledAt),
      youtube_stream_url: orNull(parsed.data.streamUrl),
      replay_url: orNull(parsed.data.replayUrl),
    })
    .eq('id', id)
  if (error) return { error: 'Could not save the match. Please try again.' }

  revalidateMatch(id, m.tournament_id, first(m.tournament as SlugRef)?.slug ?? null)
  return { success: true }
}

export async function toggleMatchLive(
  _prev: MatchAdminState,
  formData: FormData,
): Promise<MatchAdminState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing match.' }

  const supabase = createClient()
  const { data: m } = await supabase
    .from('matches')
    .select('id, status, tournament_id, tournament:tournaments(status, slug)')
    .eq('id', id)
    .maybeSingle()
  if (!m) return { error: 'Match not found.' }
  if (m.status !== 'scheduled' && m.status !== 'live')
    return { error: 'Only a scheduled or live match can be toggled.' }

  const t = first(m.tournament as StatusSlugRef)
  // tournaments.status has no 'cancelled' value; 'completed' is the operative guard.
  if (t?.status === 'completed') return { error: 'This tournament is completed.' }

  const next = m.status === 'live' ? 'scheduled' : 'live'
  const { error } = await supabase.from('matches').update({ status: next }).eq('id', id)
  if (error) return { error: 'Could not update the match status.' }

  revalidateMatch(id, m.tournament_id, t?.slug ?? null)
  return { success: true }
}
