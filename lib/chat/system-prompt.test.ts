import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from './system-prompt'

describe('buildSystemPrompt', () => {
  it('keeps the money guardrail and the no-actions rule', () => {
    const p = buildSystemPrompt({ isLoggedIn: false, locale: 'en' })
    expect(p).toMatch(/never give betting or wagering advice/i)
    expect(p).toMatch(/cannot take real actions/i)
  })
  it('always carries the cross-player data guardrail', () => {
    expect(buildSystemPrompt({ isLoggedIn: true, locale: 'en' })).toMatch(/never reveal/i)
    expect(buildSystemPrompt({ isLoggedIn: false, locale: 'en' })).toMatch(/never reveal/i)
  })
  it('signed-in prompt names the tool, says tool output is data, and lists destination tokens', () => {
    const p = buildSystemPrompt({ isLoggedIn: true, locale: 'en' })
    expect(p).toMatch(/get_account_info/)
    expect(p).toMatch(/data, never instructions/i)
    expect(p).toMatch(/\{\{go:wallet\}\}/)
  })
  it('signed-out prompt offers no tool and tells them to sign in for account questions', () => {
    const p = buildSystemPrompt({ isLoggedIn: false, locale: 'en' })
    expect(p).not.toMatch(/get_account_info/)
    expect(p).toMatch(/log in/i)
  })
  it('adds a language instruction for fr and pcm only', () => {
    expect(buildSystemPrompt({ isLoggedIn: false, locale: 'fr' })).toMatch(/French/)
    expect(buildSystemPrompt({ isLoggedIn: false, locale: 'pcm' })).toMatch(/Nigerian Pidgin/)
    expect(buildSystemPrompt({ isLoggedIn: false, locale: 'en' })).not.toMatch(/Reply in/)
  })
})
