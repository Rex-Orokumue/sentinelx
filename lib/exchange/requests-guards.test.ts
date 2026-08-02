import { describe, it, expect } from 'vitest'
import { canAdminSetStatus, canBuyerCancel } from './requests-guards'

describe('canAdminSetStatus', () => {
  it('allows open -> in_progress', () => {
    expect(canAdminSetStatus('open', 'in_progress')).toBe(true)
  })
  it('allows open -> fulfilled directly (admin can skip in_progress)', () => {
    expect(canAdminSetStatus('open', 'fulfilled')).toBe(true)
  })
  it('allows in_progress -> fulfilled', () => {
    expect(canAdminSetStatus('in_progress', 'fulfilled')).toBe(true)
  })
  it('allows open -> closed', () => {
    expect(canAdminSetStatus('open', 'closed')).toBe(true)
  })
  it('allows in_progress -> closed', () => {
    expect(canAdminSetStatus('in_progress', 'closed')).toBe(true)
  })
  it('rejects any transition out of a terminal fulfilled state', () => {
    expect(canAdminSetStatus('fulfilled', 'closed')).toBe(false)
    expect(canAdminSetStatus('fulfilled', 'open')).toBe(false)
  })
  it('rejects any transition out of a terminal closed state', () => {
    expect(canAdminSetStatus('closed', 'open')).toBe(false)
    expect(canAdminSetStatus('closed', 'fulfilled')).toBe(false)
  })
  it('rejects a no-op transition to the same status', () => {
    expect(canAdminSetStatus('open', 'open')).toBe(false)
  })
})

describe('canBuyerCancel', () => {
  it('allows cancelling an open request', () => {
    expect(canBuyerCancel('open')).toBe(true)
  })
  it('rejects cancelling once in_progress', () => {
    expect(canBuyerCancel('in_progress')).toBe(false)
  })
  it('rejects cancelling a terminal request', () => {
    expect(canBuyerCancel('fulfilled')).toBe(false)
    expect(canBuyerCancel('closed')).toBe(false)
  })
})
