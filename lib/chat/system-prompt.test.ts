import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from './system-prompt'

describe('buildSystemPrompt', () => {
  it('mentions the account-snapshot tool only when logged in', () => {
    expect(buildSystemPrompt(true)).toContain('get_account_snapshot')
    expect(buildSystemPrompt(false)).not.toContain('get_account_snapshot')
  })

  it('tells a logged-out visitor to log in for account questions', () => {
    expect(buildSystemPrompt(false)).toMatch(/log in/i)
  })

  it('always carries the money/betting guardrail', () => {
    expect(buildSystemPrompt(true)).toMatch(/betting|wagering/i)
    expect(buildSystemPrompt(false)).toMatch(/betting|wagering/i)
  })

  it('always carries the cross-player data guardrail', () => {
    expect(buildSystemPrompt(true)).toMatch(/never reveal/i)
    expect(buildSystemPrompt(false)).toMatch(/never reveal/i)
  })
})
