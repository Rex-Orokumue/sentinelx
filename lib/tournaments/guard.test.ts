import { describe, it, expect } from 'vitest'
import { checkCanRegister } from './guard'

describe('checkCanRegister', () => {
  it('allows an open tournament with capacity and no prior registration', () => {
    expect(
      checkCanRegister({ status: 'registration_open', paidCount: 3, maxPlayers: 16, existingStatus: null }),
    ).toEqual({ ok: true })
  })

  it('allows a pending registration to proceed (reuse reference)', () => {
    expect(
      checkCanRegister({ status: 'registration_open', paidCount: 3, maxPlayers: 16, existingStatus: 'pending' }),
    ).toEqual({ ok: true })
  })

  it('blocks a player who already paid', () => {
    expect(
      checkCanRegister({ status: 'registration_open', paidCount: 3, maxPlayers: 16, existingStatus: 'paid' }),
    ).toEqual({ ok: false, reason: 'already_registered' })
  })

  it('blocks when registration is not open', () => {
    expect(
      checkCanRegister({ status: 'registration_closed', paidCount: 3, maxPlayers: 16, existingStatus: null }),
    ).toEqual({ ok: false, reason: 'not_open' })
  })

  it('blocks when the tournament is full', () => {
    expect(
      checkCanRegister({ status: 'registration_open', paidCount: 16, maxPlayers: 16, existingStatus: null }),
    ).toEqual({ ok: false, reason: 'full' })
  })

  it('treats null max_players as uncapped', () => {
    expect(
      checkCanRegister({ status: 'registration_open', paidCount: 999, maxPlayers: null, existingStatus: null }),
    ).toEqual({ ok: true })
  })
})
