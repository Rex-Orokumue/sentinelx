import { describe, it, expect } from 'vitest'
import { regKey, reminderKey, resultKey, prizeKey, disqualifyKey } from './keys'

describe('dedupe keys', () => {
  it('formats each key type', () => {
    expect(regKey('r1')).toBe('reg:r1')
    expect(reminderKey('m1', 'p1')).toBe('reminder:m1:p1')
    expect(resultKey('m1', 'p1')).toBe('result:m1:p1')
    expect(prizeKey('w1')).toBe('prize:w1')
    expect(disqualifyKey('reg1')).toBe('disqualify:reg1')
  })
})
