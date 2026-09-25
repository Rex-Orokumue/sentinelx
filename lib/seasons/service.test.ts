import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { SEASON_FIXTURE_TABLES } from '@/lib/testing/progress-fixtures'
import { getSeasonSections, listSeasons } from './service'

describe('season services', () => {
  it('lists seasons', async () => {
    const { client } = fakeSupabase(SEASON_FIXTURE_TABLES)
    const seasons = await listSeasons(client as never)
    expect(seasons.map((s) => s.slug)).toEqual(['season-1'])
  })

  it('puts DLS first in game sections', async () => {
    const { client } = fakeSupabase({
      ...SEASON_FIXTURE_TABLES,
      games: [
        { id: 'g-ff', name: 'Free Fire', slug: 'free-fire', active: true },
        { id: 'g-dls', name: 'Dream League Soccer', slug: 'dls', active: true },
      ],
    })
    const sections = await getSeasonSections(client as never, client as never, 's1')
    expect(sections.map((s) => s.gameName)).toEqual(['Dream League Soccer', 'Free Fire'])
  })
})
