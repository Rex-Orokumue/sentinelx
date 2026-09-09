// Sanity checks across a points-race tournament's whole stage plan.
//
// The database constrains each stage on its own (rounds 1-20, lobby 2-100,
// advance >= 1) but cannot see the plan as a sequence. "Stage 2 advances 30
// when only 24 reached it" is a perfectly legal row and a tournament that can
// never resolve, so it has to be caught here.
//
// Reports, never rewrites: an admin's numbers are the admin's. Same rule as
// the lobby grid's validation flags.

export interface StagePlanInput {
  seq: number
  name: string
  roundsCount: number
  lobbySize: number
  advanceCount: number
}

export type StagePlanIssueCode =
  | 'no_stages'
  | 'advance_exceeds_intake'
  | 'final_stage_not_single_winner'
  | 'duplicate_seq'

export interface StagePlanIssue {
  code: StagePlanIssueCode
  seq: number | null
  message: string
  severity: 'error' | 'warning'
}

// `entrantCount` is null while registration is still open — the usual moment an
// admin sets a tournament up. The intake check on stage 1 is skipped then
// rather than blocking the plan, since there is genuinely nothing to check
// against yet.
export function validateStagePlan(
  stages: StagePlanInput[],
  entrantCount: number | null,
): StagePlanIssue[] {
  if (stages.length === 0) {
    return [
      {
        code: 'no_stages',
        seq: null,
        severity: 'error',
        message: 'A points-race tournament needs at least one stage.',
      },
    ]
  }

  const issues: StagePlanIssue[] = []
  const ordered = [...stages].sort((a, b) => a.seq - b.seq)

  const seen = new Set<number>()
  for (const s of ordered) {
    if (seen.has(s.seq)) {
      issues.push({
        code: 'duplicate_seq',
        seq: s.seq,
        severity: 'error',
        message: `Two stages share position ${s.seq}. Each stage needs its own place in the order.`,
      })
    }
    seen.add(s.seq)
  }

  // Stage 1 takes the whole field; every later stage takes exactly what the
  // one before it advanced.
  let intake: number | null = entrantCount
  for (const s of ordered) {
    if (intake !== null && s.advanceCount > intake) {
      issues.push({
        code: 'advance_exceeds_intake',
        seq: s.seq,
        severity: 'error',
        message: `${s.name} advances ${s.advanceCount} but only ${intake} entrant(s) reach it.`,
      })
    }
    intake = s.advanceCount
  }

  const last = ordered[ordered.length - 1]
  if (last.advanceCount !== 1) {
    issues.push({
      code: 'final_stage_not_single_winner',
      seq: last.seq,
      severity: 'warning',
      message: `${last.name} ends with ${last.advanceCount} entrants rather than a single champion.`,
    })
  }

  return issues
}
