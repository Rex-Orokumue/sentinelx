import { describe, it, expect } from 'vitest'
import { orderedPair } from './thread-key'

describe('orderedPair', () => {
  it('puts the lexicographically smaller uuid first', () => {
    expect(orderedPair('bbb', 'aaa')).toEqual({ playerA: 'aaa', playerB: 'bbb' })
  })
  it('is order-independent', () => {
    expect(orderedPair('aaa', 'bbb')).toEqual(orderedPair('bbb', 'aaa'))
  })
  it('rejects a self-pair', () => {
    expect(() => orderedPair('aaa', 'aaa')).toThrow(/cannot message themselves/i)
  })
})
