import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { RegistrationFieldsPanel } from '@/components/admin/RegistrationFieldsPanel'
import { ModesPanel } from '@/components/admin/ModesPanel'

export const metadata: Metadata = { title: 'Game Designer · Admin · SentinelX' }

export default async function GameDesignerPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: game } = await supabase.from('games').select('id, name, category, active').eq('id', params.id).maybeSingle()
  if (!game) notFound()

  const { data: fieldRows } = await supabase
    .from('game_registration_fields')
    .select('id, field_key, label, placeholder, input_type, required, validation_pattern, validation_message, show_on_bracket, active')
    .eq('game_id', game.id)
    .eq('active', true)
    .order('seq')

  const fields = (fieldRows ?? []).map((f) => ({
    id: f.id,
    fieldKey: f.field_key,
    label: f.label,
    placeholder: f.placeholder,
    inputType: f.input_type as 'text' | 'number' | 'url',
    required: f.required,
    validationPattern: f.validation_pattern,
    validationMessage: f.validation_message,
    showOnBracket: f.show_on_bracket,
  }))

  const { data: modeRows } = await supabase
    .from('game_modes')
    .select('id, name, competition_format, active')
    .eq('game_id', game.id)
    .order('seq')
  const modes = (modeRows ?? []).map((m) => ({ id: m.id, name: m.name, competitionFormat: m.competition_format, active: m.active }))
  // Formats/Maps/Match Rules are only ever rendered under an ACTIVE mode's
  // expanded panel (an inactive mode shows just its own Reactivate button,
  // per ModesPanel) — no need to fetch children for a mode nothing can
  // currently expand.
  const activeModeIds = modes.filter((m) => m.active).map((m) => m.id)

  const [{ data: formatRows }, { data: mapRows }, { data: ruleRows }] = activeModeIds.length
    ? await Promise.all([
        supabase
          .from('game_mode_formats')
          .select('id, mode_id, name, entry_unit, team_size, available, active')
          .in('mode_id', activeModeIds)
          .order('seq'),
        supabase.from('game_mode_maps').select('id, mode_id, name, active').in('mode_id', activeModeIds).order('seq'),
        supabase.from('game_mode_match_rules').select('id, mode_id, name, active').in('mode_id', activeModeIds).order('seq'),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]

  const formats = (formatRows ?? []).map((f) => ({
    id: f.id,
    modeId: f.mode_id,
    name: f.name,
    entryUnit: f.entry_unit,
    teamSize: f.team_size,
    available: f.available,
    active: f.active,
  }))
  const maps = (mapRows ?? []).map((m) => ({ id: m.id, modeId: m.mode_id, name: m.name, active: m.active }))
  const matchRules = (ruleRows ?? []).map((r) => ({ id: r.id, modeId: r.mode_id, name: r.name, active: r.active }))

  return (
    <section className="max-w-2xl space-y-8">
      <Link href="/admin/games" className="text-sm text-violet-400 hover:text-violet-300">
        ← Games
      </Link>
      <h2 className="text-base font-bold text-white">{game.name} <span className="font-normal text-slate-500">— {game.category} · {game.active ? 'Active' : 'Inactive'}</span></h2>

      <RegistrationFieldsPanel gameId={game.id} fields={fields} />
      <ModesPanel gameId={game.id} modes={modes} formats={formats} maps={maps} matchRules={matchRules} />
    </section>
  )
}
