import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin() }))

const AT = '2026-10-10T10:00:00.000Z'
function fakeAdmin() {
  let coinQueries = 0
  return {
    from(table: string) {
      const result = () => ({
        data: table === 'profiles' ? { username: 'owner' }
          : table === 'referrals' ? [{ id: 'r1', status: 'converted', created_at: AT, converted_at: AT, coins_awarded: 250, referred: { username: 'friend', display_name: 'Friend', avatar_url: null, membership_tier: 'recruit', equipped_avatar_border: null } }]
            : table === 'achievements' ? [{ slug: 'referral_squad', coin_reward: 500 }]
              : ++coinQueries === 1 ? [{ amount: 250 }, { amount: 250 }]
                : [{ id: 'm1', amount: 250, description: 'First Recruit', created_at: AT }],
      })
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        maybeSingle: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      }
      return chain
    },
  }
}

import Page from './page'

describe('referrals web page', () => {
  it('passes the existing referral panel data to the UI', async () => {
    const shell = await Page() as { props: { children: unknown[] } }
    const panel = shell.props.children[1] as { props: Record<string, unknown> }
    expect(panel.props).toMatchObject({
      username: 'owner', totalReferrals: 1, convertedCount: 1, totalCoinsEarned: 500,
      nextMilestoneCount: 5, nextMilestoneBonusCoins: 500,
      referredPlayers: [{ id: 'r1', name: 'Friend', status: 'converted', coinsAwarded: 250 }],
      milestoneHistory: [{ id: 'm1', description: 'First Recruit', coins: 250, date: AT }],
    })
  })
})
