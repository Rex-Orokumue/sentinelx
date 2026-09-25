import { describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/lib/testing/fake-supabase'
import { FIXTURE_TABLES } from '@/lib/testing/progress-fixtures'
import { getRankings } from './service'

describe('getRankings viewer seam', () => {
  it('uses an explicit viewer id without consulting auth.getUser', async () => {
    const { client } = fakeSupabase(FIXTURE_TABLES)
    const getUser = vi.spyOn(client.auth, 'getUser')

    const result = await getRankings(
      client as never,
      { gameSlug: null, region: null, page: 1 },
      { mode: 'id', id: 'p5' },
    )

    expect(getUser).not.toHaveBeenCalled()
    expect(result.viewerRanked?.id).toBe('p5')
    expect(result.viewer?.id).toBe('p5')
  })
})
