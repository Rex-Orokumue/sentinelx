import { describe, it, expect } from 'vitest'
import { hashCode, codeMatches } from './hash'

describe('hashCode / codeMatches', () => {
  it('is deterministic for the same code', () => {
    expect(hashCode('123456')).toBe(hashCode('123456'))
  })

  it('matches the correct code against its hash', () => {
    expect(codeMatches('123456', hashCode('123456'))).toBe(true)
  })

  it('rejects an incorrect code', () => {
    expect(codeMatches('654321', hashCode('123456'))).toBe(false)
  })
})
