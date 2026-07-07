import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { updateTournament } from '@/lib/tournaments/admin-actions'
import { TournamentForm, type TournamentFormValues } from '@/components/admin/TournamentForm'

export const metadata: Metadata = { title: 'Edit tournament · Admin · SentinelX' }

// timestamptz ISO -> value for <input type="datetime-local"> ('YYYY-MM-DDTHH:mm').
function toLocalInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : ''
}
function moneyStr(n: number | null): string {
  return n == null ? '' : String(n)
}

export default async function EditTournamentPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const [{ data: t }, { data: games }] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', params.id).maybeSingle(),
    supabase.from('games').select('id, name').eq('active', true).order('name'),
  ])
  if (!t) notFound()

  const initial: TournamentFormValues = {
    id: t.id,
    title: t.title,
    slug: t.slug,
    gameId: t.game_id,
    description: t.description ?? '',
    bannerUrl: t.banner_url ?? '',
    registrationFee: moneyStr(t.registration_fee),
    prizePool: moneyStr(t.prize_pool),
    maxPlayers: t.max_players == null ? '' : String(t.max_players),
    registrationStart: toLocalInput(t.registration_start),
    registrationEnd: toLocalInput(t.registration_end),
    tournamentStart: toLocalInput(t.tournament_start),
    tournamentEnd: toLocalInput(t.tournament_end),
  }

  return (
    <section className="max-w-xl">
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">
        Edit · <span className="text-slate-400">{t.status.replace(/_/g, ' ')}</span>
      </h2>
      <TournamentForm
        action={updateTournament}
        games={games ?? []}
        initial={initial}
        slugLocked={t.status !== 'draft'}
        submitLabel="Save changes"
      />
    </section>
  )
}
