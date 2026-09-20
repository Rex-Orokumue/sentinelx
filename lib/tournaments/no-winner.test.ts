import { describe, it, expect } from 'vitest'
import {
  canCloseWithoutWinner,
  isClosedWithoutWinner,
  finalSideIds,
  withoutEntities,
  type FinalMatchRow,
} from './no-winner'

const final = (over: Partial<FinalMatchRow> = {}): FinalMatchRow => ({
  id: 'f1',
  round: 'final',
  status: 'disputed',
  score_a: null,
  score_b: null,
  player_a_id: 'malik',
  player_b_id: 'aag',
  ...over,
})

describe('canCloseWithoutWinner', () => {
  it('accepts an active tournament whose final is disputed', () => {
    const r = canCloseWithoutWinner('active', [final()])
    expect(r).toEqual({ ok: true, final: final() })
  })
  it('rejects a tournament that is not active', () => {
    for (const s of ['draft', 'registration_open', 'registration_closed', 'completed', 'cancelled']) {
      expect(canCloseWithoutWinner(s, [final()]).ok).toBe(false)
    }
  })
  it('rejects when there is no final', () => {
    const r = canCloseWithoutWinner('active', [final({ round: 'semi_final' })])
    expect(r).toMatchObject({ ok: false, reason: 'This tournament has no final match.' })
  })
  it('rejects when the final is not disputed', () => {
    for (const s of ['scheduled', 'live', 'completed', 'forfeited', 'cancelled']) {
      expect(canCloseWithoutWinner('active', [final({ status: s })]).ok).toBe(false)
    }
  })
})

describe('isClosedWithoutWinner', () => {
  it('is true only for completed + disputed final', () => {
    expect(isClosedWithoutWinner('completed', [{ round: 'final', status: 'disputed' }])).toBe(true)
    expect(isClosedWithoutWinner('active', [{ round: 'final', status: 'disputed' }])).toBe(false)
    expect(isClosedWithoutWinner('completed', [{ round: 'final', status: 'completed' }])).toBe(false)
    expect(isClosedWithoutWinner('completed', [{ round: 'semi_final', status: 'disputed' }])).toBe(false)
    expect(isClosedWithoutWinner('completed', [])).toBe(false)
  })
})

describe('finalSideIds', () => {
  it('returns both player ids for a solo final', () => {
    expect(finalSideIds(final())).toEqual(['malik', 'aag'])
  })
  it('returns both squad ids for a team final', () => {
    expect(
      finalSideIds(final({ player_a_id: null, player_b_id: null, team_a_id: 'sqA', team_b_id: 'sqB' })),
    ).toEqual(['sqA', 'sqB'])
  })
  it('drops an empty side', () => {
    expect(finalSideIds(final({ player_b_id: null }))).toEqual(['malik'])
  })
})

describe('withoutEntities', () => {
  it('removes the excluded solo players and keeps everyone else in order', () => {
    expect(withoutEntities(['a', 'malik', 'b', 'aag'], ['malik', 'aag'])).toEqual(['a', 'b'])
  })
  it('returns the input untouched when nothing is excluded', () => {
    const ids = ['a', 'b']
    expect(withoutEntities(ids, [])).toBe(ids)
  })
  it('removes every roster member of an excluded squad', () => {
    const map = new Map([
      ['p1', 'sqA'],
      ['p2', 'sqA'],
      ['p3', 'sqB'],
      ['p4', 'sqC'],
    ])
    expect(withoutEntities(['p1', 'p2', 'p3', 'p4'], ['sqA', 'sqB'], map)).toEqual(['p4'])
  })
})
