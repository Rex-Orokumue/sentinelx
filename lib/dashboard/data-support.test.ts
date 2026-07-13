import { describe, it, expect } from 'vitest'
import { computeDataSupportEligibility, buildDataSupportClaimUrl, type DataSupportMatch } from './data-support'

describe('computeDataSupportEligibility', () => {
  it('returns nothing when no round is semi_final/final', () => {
    const matches: DataSupportMatch[] = [
      { round: 'quarter_final', tournamentId: 't1', tournamentTitle: 'Cup', dataSupportText: '1GB', dataSupportWhatsapp: '0801' },
    ]
    expect(computeDataSupportEligibility(matches)).toEqual([])
  })

  it('returns nothing when the tournament has no data support configured', () => {
    const matches: DataSupportMatch[] = [
      { round: 'final', tournamentId: 't1', tournamentTitle: 'Cup', dataSupportText: null, dataSupportWhatsapp: null },
    ]
    expect(computeDataSupportEligibility(matches)).toEqual([])
  })

  it('marks a semi_final row as stage semi-final', () => {
    const matches: DataSupportMatch[] = [
      { round: 'semi_final', tournamentId: 't1', tournamentTitle: 'Cup', dataSupportText: '1GB', dataSupportWhatsapp: '0801' },
    ]
    expect(computeDataSupportEligibility(matches)).toEqual([
      { tournamentId: 't1', tournamentTitle: 'Cup', text: '1GB', whatsapp: '0801', stage: 'semi-final' },
    ])
  })

  it('prefers final over semi_final when both rows exist for the same tournament', () => {
    const matches: DataSupportMatch[] = [
      { round: 'semi_final', tournamentId: 't1', tournamentTitle: 'Cup', dataSupportText: '1GB', dataSupportWhatsapp: '0801' },
      { round: 'final', tournamentId: 't1', tournamentTitle: 'Cup', dataSupportText: '1GB', dataSupportWhatsapp: '0801' },
    ]
    expect(computeDataSupportEligibility(matches)).toEqual([
      { tournamentId: 't1', tournamentTitle: 'Cup', text: '1GB', whatsapp: '0801', stage: 'final' },
    ])
  })

  it('returns one row per eligible tournament when a player is eligible in more than one', () => {
    const matches: DataSupportMatch[] = [
      { round: 'final', tournamentId: 't1', tournamentTitle: 'Cup 1', dataSupportText: '1GB', dataSupportWhatsapp: '0801' },
      { round: 'semi_final', tournamentId: 't2', tournamentTitle: 'Cup 2', dataSupportText: '2GB', dataSupportWhatsapp: '0802' },
    ]
    expect(computeDataSupportEligibility(matches)).toEqual([
      { tournamentId: 't1', tournamentTitle: 'Cup 1', text: '1GB', whatsapp: '0801', stage: 'final' },
      { tournamentId: 't2', tournamentTitle: 'Cup 2', text: '2GB', whatsapp: '0802', stage: 'semi-final' },
    ])
  })
})

describe('buildDataSupportClaimUrl', () => {
  it('builds the exact pre-filled wa.me message', () => {
    const url = buildDataSupportClaimUrl({
      whatsapp: '08012345678',
      username: 'chidi',
      tournamentTitle: 'DLS Cup 4',
      stage: 'final',
    })
    expect(url).toBe(
      'https://wa.me/2348012345678?text=' +
        encodeURIComponent("Hi, I'm chidi and I reached the final of DLS Cup 4. I'd like to claim my data support."),
    )
  })

  it('returns null for an unparseable WhatsApp number', () => {
    const url = buildDataSupportClaimUrl({
      whatsapp: 'not-a-number',
      username: 'chidi',
      tournamentTitle: 'DLS Cup 4',
      stage: 'semi-final',
    })
    expect(url).toBeNull()
  })
})
