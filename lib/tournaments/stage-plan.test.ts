import { describe, it, expect } from 'vitest'
import { validateStagePlan, type StagePlanInput } from './stage-plan'

function stage(seq: number, advanceCount: number, over: Partial<StagePlanInput> = {}): StagePlanInput {
  return { seq, name: `Stage ${seq}`, roundsCount: 3, lobbySize: 48, advanceCount, ...over }
}

describe('validateStagePlan', () => {
  it('accepts a qualifiers-then-finals plan', () => {
    const issues = validateStagePlan([stage(1, 24), stage(2, 1)], 96)
    expect(issues).toEqual([])
  })

  it('accepts a single-stage one-off cup', () => {
    // One stage, one round, one winner — the smallest legitimate plan.
    expect(validateStagePlan([stage(1, 1, { roundsCount: 1 })], 12)).toEqual([])
  })

  it('flags a tournament with no stages at all', () => {
    const issues = validateStagePlan([], 48)
    expect(issues.map((i) => i.code)).toEqual(['no_stages'])
    expect(issues[0].severity).toBe('error')
  })

  it('flags a stage advancing more entrants than reached it', () => {
    // Stage 2 receives 24 from stage 1 but tries to advance 30. Nothing in the
    // database prevents this; it just produces a stage that can never resolve.
    const issues = validateStagePlan([stage(1, 24), stage(2, 30)], 96)
    const issue = issues.find((i) => i.code === 'advance_exceeds_intake')
    expect(issue).toBeDefined()
    expect(issue!.seq).toBe(2)
    expect(issue!.severity).toBe('error')
  })

  it('flags the first stage advancing more than the entrant count', () => {
    const issues = validateStagePlan([stage(1, 50), stage(2, 1)], 40)
    expect(issues.find((i) => i.code === 'advance_exceeds_intake')?.seq).toBe(1)
  })

  it('does not flag the first stage when the entrant count is not yet known', () => {
    // Registration is still open, so there is no entrant count to check
    // against. Refusing to save the plan here would stop an admin setting a
    // tournament up in advance, which is when they actually do it.
    const issues = validateStagePlan([stage(1, 24), stage(2, 1)], null)
    expect(issues).toEqual([])
  })

  it('warns when the final stage does not end with a single winner', () => {
    const issues = validateStagePlan([stage(1, 24), stage(2, 4)], 96)
    const issue = issues.find((i) => i.code === 'final_stage_not_single_winner')
    expect(issue).toBeDefined()
    // A warning, not an error: an admin may deliberately end on a top-4 that
    // feeds an offline final.
    expect(issue!.severity).toBe('warning')
  })

  it('flags duplicate sequence numbers', () => {
    const issues = validateStagePlan([stage(1, 24), stage(1, 1)], 96)
    expect(issues.some((i) => i.code === 'duplicate_seq')).toBe(true)
  })

  it('evaluates stages in seq order regardless of input order', () => {
    // The editor may hand them over in whatever order the rows were edited.
    const issues = validateStagePlan([stage(2, 30), stage(1, 24)], 96)
    expect(issues.find((i) => i.code === 'advance_exceeds_intake')?.seq).toBe(2)
  })

  it('reports every problem at once', () => {
    const issues = validateStagePlan([stage(1, 999), stage(2, 4)], 40)
    expect(issues.length).toBeGreaterThan(1)
  })

  it('gives every issue a message', () => {
    for (const i of validateStagePlan([stage(1, 999), stage(2, 4)], 40)) {
      expect(i.message.length).toBeGreaterThan(0)
    }
  })
})
