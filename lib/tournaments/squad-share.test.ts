import { describe, it, expect } from 'vitest'
import { squadInviteShareUrl } from './squad-share'

describe('squadInviteShareUrl', () => {
  it('builds a wa.me link carrying the squad name, code, and tournament link', () => {
    const url = squadInviteShareUrl({
      tournamentTitle: 'Free Fire Clash Squad Cup',
      tournamentSlug: 'free-fire-clash-squad-cup',
      squadName: 'Lagos Vipers',
      inviteCode: 'ABCDEFGH',
    })
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    const text = decodeURIComponent(url.replace('https://wa.me/?text=', ''))
    expect(text).toContain('Lagos Vipers')
    expect(text).toContain('ABCDEFGH')
    expect(text).toContain('/tournaments/free-fire-clash-squad-cup')
  })
})
