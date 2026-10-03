import { describe, it, expect } from 'vitest'
import { fetchGameInterestSegment, fetchConsentingCountries } from './game-interest-segment-query'

type Call = { method: string; args: unknown[] }

// A PostgREST-shaped stand-in: records every chained call and serves `.range()`
// from a fixed dataset the way the real API does (inclusive bounds, capped by
// whatever the caller asks for).
function fakeAdmin(dataset: unknown[]) {
  const calls: Call[] = []
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  builder.range = (from: number, to: number) => {
    calls.push({ method: 'range', args: [from, to] })
    return Promise.resolve({ data: dataset.slice(from, to + 1) })
  }
  const from = (table: string) => {
    calls.push({ method: 'from', args: [table] })
    return builder
  }
  return { admin: { from } as never, calls }
}

const row = (i: number) => ({
  user_id: `u${i}`,
  profiles: { id: `u${i}`, username: `p${i}`, display_name: null, country: 'Nigeria', whatsapp_number: '+2348012345678', consent_whatsapp_updates: true },
  games: { name: 'EA FC Mobile' },
})

describe('fetchGameInterestSegment', () => {
  it('pages past the 1000-row API cap so a large segment is not silently truncated', async () => {
    const dataset = Array.from({ length: 2500 }, (_, i) => row(i))
    const { admin } = fakeAdmin(dataset)
    const rows = await fetchGameInterestSegment(admin, {})
    expect(rows).toHaveLength(2500)
  })

  it('always restricts to players who consented, with no filters by default', async () => {
    const { admin, calls } = fakeAdmin([row(1)])
    await fetchGameInterestSegment(admin, {})
    const eqs = calls.filter((c) => c.method === 'eq').map((c) => c.args)
    expect(eqs).toEqual([['profiles.consent_whatsapp_updates', true]])
  })

  it('applies the game and country filters when given', async () => {
    const { admin, calls } = fakeAdmin([row(1)])
    await fetchGameInterestSegment(admin, { game: 'g1', country: 'Ghana' })
    const eqs = calls.filter((c) => c.method === 'eq').map((c) => c.args)
    expect(eqs).toContainEqual(['game_id', 'g1'])
    expect(eqs).toContainEqual(['profiles.country', 'Ghana'])
    expect(eqs).toContainEqual(['profiles.consent_whatsapp_updates', true])
  })

  it('orders deterministically so pages never overlap or skip a row', async () => {
    const { admin, calls } = fakeAdmin([row(1)])
    await fetchGameInterestSegment(admin, {})
    expect(calls.filter((c) => c.method === 'order').map((c) => c.args[0])).toEqual(['user_id', 'game_id'])
  })
})

describe('fetchConsentingCountries', () => {
  it('returns each distinct country once, sorted, ignoring blanks', async () => {
    const { admin } = fakeAdmin([
      { country: 'Ghana' },
      { country: 'Nigeria' },
      { country: 'Ghana' },
      { country: null },
      { country: '' },
    ])
    expect(await fetchConsentingCountries(admin)).toEqual(['Ghana', 'Nigeria'])
  })

  it('only looks at players who consented', async () => {
    const { admin, calls } = fakeAdmin([{ country: 'Ghana' }])
    await fetchConsentingCountries(admin)
    expect(calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([['consent_whatsapp_updates', true]])
  })
})
