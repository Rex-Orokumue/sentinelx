import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { updateTournament } from '@/lib/tournaments/admin-actions'
import { TournamentForm, type TournamentFormValues } from '@/components/admin/TournamentForm'
import { fetchModeCatalogue } from '@/lib/tournaments/mode-catalogue'
import { withRetiredSelections } from '@/lib/tournaments/edit-catalogue'

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
  const [{ data: t }, { data: games }, { data: seasons }, catalogue] = await Promise.all([
    supabase.from('tournaments').select('*').eq('id', params.id).maybeSingle(),
    supabase.from('games').select('id, name, slug, supported_formats').eq('active', true).order('name'),
    supabase.from('seasons').select('id, name').order('start_date', { ascending: false }),
    fetchModeCatalogue(),
  ])
  if (!t) notFound()

  // A tournament's own mode/format/map/rule/match-type can have gone
  // inactive since it was saved (retired via the Game Designer) —
  // fetchModeCatalogue() only returns active rows, so without this the
  // form's <select> would have no matching <option> and an unrelated save
  // would silently drop or swap it. Only looked up when the id isn't
  // already in the active catalogue, and scoped to this render only.
  const [modeLookup, formatLookup, mapLookup, matchRuleLookup, matchTypeLookup] = await Promise.all([
    t.mode_id && !catalogue.modes.some((m) => m.id === t.mode_id)
      ? supabase.from('game_modes').select('id, game_id, slug, name, competition_format').eq('id', t.mode_id).maybeSingle()
      : Promise.resolve({ data: null }),
    t.format_id && !catalogue.formats.some((f) => f.id === t.format_id)
      ? supabase.from('game_mode_formats').select('id, mode_id, slug, name, entry_unit, team_size, available').eq('id', t.format_id).maybeSingle()
      : Promise.resolve({ data: null }),
    t.default_map_id && !catalogue.maps.some((m) => m.id === t.default_map_id)
      ? supabase.from('game_mode_maps').select('id, mode_id, name').eq('id', t.default_map_id).maybeSingle()
      : Promise.resolve({ data: null }),
    t.match_rule_id && !catalogue.matchRules.some((r) => r.id === t.match_rule_id)
      ? supabase.from('game_mode_match_rules').select('id, mode_id, name').eq('id', t.match_rule_id).maybeSingle()
      : Promise.resolve({ data: null }),
    t.match_type_id && !catalogue.matchTypes.some((mt) => mt.id === t.match_type_id)
      ? supabase.from('match_types').select('id, slug, name, available').eq('id', t.match_type_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const enrichedCatalogue = withRetiredSelections(catalogue, {
    mode: modeLookup.data,
    format: formatLookup.data,
    map: mapLookup.data,
    matchRule: matchRuleLookup.data,
    matchType: matchTypeLookup.data,
  })

  const initial: TournamentFormValues = {
    id: t.id,
    title: t.title,
    slug: t.slug,
    gameId: t.game_id,
    description: t.description ?? '',
    bannerUrl: t.banner_url ?? '',
    cardImageUrl: t.card_image_url ?? '',
    registrationFee: moneyStr(t.registration_fee),
    prizePool: moneyStr(t.prize_pool),
    maxPlayers: t.max_players == null ? '' : String(t.max_players),
    registrationStart: toLocalInput(t.registration_start),
    registrationEnd: toLocalInput(t.registration_end),
    tournamentStart: toLocalInput(t.tournament_start),
    tournamentEnd: toLocalInput(t.tournament_end),
    rules: t.rules ?? '',
    dataSupportText: t.data_support_text ?? '',
    dataSupportWhatsapp: t.data_support_whatsapp ?? '',
    tournamentType: t.tournament_type,
    seasonId: t.season_id ?? '',
    format: t.format,
    manualKnockoutPairing: t.manual_knockout_pairing,
    prizeSecond: moneyStr(t.prize_second),
    prizeThird: moneyStr(t.prize_third),
    competitionFormat: t.competition_format ?? 'head_to_head',
    entryUnit: t.entry_unit ?? 'solo',
    squadSize: t.squad_size == null ? '' : String(t.squad_size),
    modeId: t.mode_id ?? '',
    formatId: t.format_id ?? '',
    defaultMapId: t.default_map_id ?? '',
    matchRuleId: t.match_rule_id ?? '',
    matchTypeId: t.match_type_id ?? '',
  }

  return (
    <section className="max-w-xl">
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">
        Edit · <span className="text-slate-400">{t.status.replace(/_/g, ' ')}</span>
      </h2>
      {(t.tournament_type === 'masters' || t.tournament_type === 'champions_cup') && (
        <Link
          href={`/admin/tournaments/${t.id}/invitations`}
          className="mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
        >
          → Manage invitations
        </Link>
      )}
      {t.competition_format === 'points_race' && (
        <Link
          href={`/admin/tournaments/${t.id}/stages`}
          className="mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
        >
          → Stages
        </Link>
      )}
      {t.competition_format === 'points_race' && (
        <Link
          href={`/admin/tournaments/${t.id}/lobbies`}
          className="mb-4 ml-4 inline-block text-sm text-violet-400 hover:text-violet-300"
        >
          → Lobbies
        </Link>
      )}
      <TournamentForm
        action={updateTournament}
        games={(games ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          slug: g.slug,
          supportedFormats: g.supported_formats ?? [],
        }))}
        seasons={seasons ?? []}
        catalogue={enrichedCatalogue}
        initial={initial}
        slugLocked={t.status !== 'draft'}
        submitLabel="Save changes"
      />
    </section>
  )
}
