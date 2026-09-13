import { describe, it, expect } from 'vitest'
import { opponentSubmissionNotice } from './submission-notice'

const base = {
  matchId: 'm1',
  playerAId: 'a',
  playerBId: 'b',
  playerAName: 'Kelvin_G',
  playerBName: 'ShadowX',
  tournamentTitle: 'Lagos Cup',
  scoreA: 3,
  scoreB: 1,
  isResubmission: false,
}

describe('opponentSubmissionNotice', () => {
  it('addresses the other player when player A submits', () => {
    const notice = opponentSubmissionNotice({ ...base, submitterId: 'a' })

    expect(notice?.recipientId).toBe('b')
    // Wording is the catalog's job now; this module decides WHO is told and
    // with WHICH values.
    expect(notice?.notification).toEqual({
      type: 'result_submitted',
      scoreline: 'Kelvin_G 3 – 1 ShadowX',
      tournament: 'Lagos Cup',
      isResubmission: false,
    })
    expect(notice?.link).toBe('/matches/m1')
  })

  it('addresses the other player when player B submits', () => {
    expect(opponentSubmissionNotice({ ...base, submitterId: 'b' })?.recipientId).toBe('a')
  })

  it('says updated, not submitted, on a re-submission', () => {
    const notice = opponentSubmissionNotice({ ...base, submitterId: 'a', isResubmission: true })

    expect(notice?.notification.isResubmission).toBe(true)
  })

  it('renders the score exactly as submitted, never reordered for the reader', () => {
    // score_a always belongs to player A regardless of who submitted, so the
    // recipient sees the same scoreline the admin will review. Flipping it to
    // "your score first" would make the two disagree.
    const notice = opponentSubmissionNotice({ ...base, submitterId: 'b' })

    expect(notice?.notification.scoreline).toBe('Kelvin_G 3 – 1 ShadowX')
  })

  it('returns nothing when the match has no opponent yet', () => {
    expect(opponentSubmissionNotice({ ...base, playerBId: null, submitterId: 'a' })).toBeNull()
  })

  it('returns nothing when the submitter is not in this match', () => {
    // Defensive: the action checks this too, but a notice addressed to the
    // wrong player is worse than no notice.
    expect(opponentSubmissionNotice({ ...base, submitterId: 'someone-else' })).toBeNull()
  })

  it('falls back to a neutral name when a profile has none', () => {
    const notice = opponentSubmissionNotice({ ...base, submitterId: 'a', playerBName: null })

    expect(notice?.notification.scoreline).toBe('Kelvin_G 3 – 1 Player')
  })
})
