import { describe, it, expect } from 'vitest'
import { transferEventTarget } from './webhook'

describe('transferEventTarget', () => {
  it('maps transfer.success to paid', () => {
    expect(transferEventTarget('transfer.success')).toBe('paid')
  })
  it('maps transfer.failed to failed', () => {
    expect(transferEventTarget('transfer.failed')).toBe('failed')
  })
  it('maps transfer.reversed to failed', () => {
    expect(transferEventTarget('transfer.reversed')).toBe('failed')
  })
  it('returns null for an unrelated event', () => {
    expect(transferEventTarget('charge.success')).toBeNull()
  })
})
