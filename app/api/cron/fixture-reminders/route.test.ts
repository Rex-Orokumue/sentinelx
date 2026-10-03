import { beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn(async (..._a: unknown[]) => {})
const notifyBoth = vi.fn(async (..._a: unknown[]) => {})
let existingKeys = new Set<string>()
let matchRows: unknown[] = []

// A thenable stand-in for a PostgREST builder: every chained call returns the
// same builder, and awaiting it yields the rows (or, for the dedupe lookup, the
// row whose key was filtered on).
function builder(table: string) {
  let key: string | null = null
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'not', 'gt', 'lte']) {
    b[m] = (...args: unknown[]) => {
      if (table === 'notifications' && m === 'eq' && args[0] === 'dedupe_key') key = args[1] as string
      return b
    }
  }
  b.maybeSingle = async () => ({ data: key && existingKeys.has(key) ? { id: 'n1' } : null })
  b.then = (resolve: (v: unknown) => void) => resolve({ data: table === 'matches' ? matchRows : [] })
  return b
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }))
vi.mock('@/lib/notifications/notify', () => ({ notify: (...a: unknown[]) => notify(...a) }))
vi.mock('@/lib/notifications/send', () => ({ notifyBoth: (...a: unknown[]) => notifyBoth(...a) }))
vi.mock('@/lib/tournaments/squad-roster', () => ({ matchRosters: vi.fn() }))

import { POST } from './route'

function soonMatch() {
  return {
    id: 'm1',
    scheduled_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    player_a_id: 'pa',
    player_b_id: 'pb',
    team_a_id: null,
    team_b_id: null,
    player_a: { display_name: 'A', username: 'a' },
    player_b: { display_name: 'B', username: 'b' },
    team_a: null,
    team_b: null,
    tournament: { title: 'Cup' },
  }
}

const authed = () =>
  new Request('http://x/api/cron/fixture-reminders', { method: 'POST', headers: { authorization: 'Bearer s3cret' } })

describe('fixture-reminders cron', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's3cret'
    notify.mockClear()
    notifyBoth.mockClear()
    existingKeys = new Set()
    matchRows = [soonMatch()]
  })

  it('reminds both players on the first run', async () => {
    const res = await POST(authed())
    expect(await res.json()).toEqual({ reminded: 2 })
    expect(notifyBoth).toHaveBeenCalledTimes(2)
  })

  it('does not re-send the bell or push for a player already reminded on an earlier run', async () => {
    existingKeys = new Set(['reminder:m1:pa', 'reminder:m1:pb'])
    const res = await POST(authed())
    expect(await res.json()).toEqual({ reminded: 0 })
    expect(notifyBoth).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('still reminds a player who was not reminded yet', async () => {
    existingKeys = new Set(['reminder:m1:pa'])
    await POST(authed())
    expect(notifyBoth).toHaveBeenCalledTimes(1)
    expect(notifyBoth.mock.calls[0]?.[0]).toBe('pb')
  })
})
