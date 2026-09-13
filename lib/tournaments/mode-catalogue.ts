import { createClient } from '@/lib/supabase/server'
import type { FormatOption, ModeOption } from './mode-selection'

export interface ModeCatalogue {
  modes: (ModeOption & { gameId: string })[]
  formats: (FormatOption & { modeId: string })[]
  maps: { id: string; name: string; modeId: string }[]
  matchRules: { id: string; name: string; modeId: string }[]
  matchTypes: { slug: string; name: string; available: boolean }[]
}

// One read for the whole catalogue. It is small (a handful of modes, formats,
// maps and rules per game) and entirely public, so it ships to the client in
// full and the dependent selects filter it locally — no round trip per Mode
// change.
export async function fetchModeCatalogue(): Promise<ModeCatalogue> {
  const supabase = createClient()
  const [modes, formats, maps, matchRules, matchTypes] = await Promise.all([
    supabase
      .from('game_modes')
      .select('id, game_id, slug, name, competition_format')
      .eq('active', true)
      .order('seq'),
    supabase
      .from('game_mode_formats')
      .select('id, mode_id, slug, name, entry_unit, team_size, available')
      .eq('active', true)
      .order('seq'),
    supabase.from('game_mode_maps').select('id, mode_id, name').eq('active', true).order('seq'),
    supabase.from('game_mode_match_rules').select('id, mode_id, name').eq('active', true).order('seq'),
    supabase.from('match_types').select('slug, name, available').eq('active', true).order('seq'),
  ])

  return {
    modes: (modes.data ?? []).map((m) => ({
      id: m.id,
      gameId: m.game_id,
      slug: m.slug,
      name: m.name,
      competitionFormat: m.competition_format,
    })),
    formats: (formats.data ?? []).map((f) => ({
      id: f.id,
      modeId: f.mode_id,
      slug: f.slug,
      name: f.name,
      entryUnit: f.entry_unit,
      teamSize: f.team_size,
      available: f.available,
    })),
    maps: (maps.data ?? []).map((m) => ({ id: m.id, name: m.name, modeId: m.mode_id })),
    matchRules: (matchRules.data ?? []).map((r) => ({ id: r.id, name: r.name, modeId: r.mode_id })),
    matchTypes: (matchTypes.data ?? []).map((t) => ({
      slug: t.slug,
      name: t.name,
      available: t.available,
    })),
  }
}
