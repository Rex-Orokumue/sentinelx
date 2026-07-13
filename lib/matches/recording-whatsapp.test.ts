import { describe, it, expect } from 'vitest'
import { buildRecordingWhatsAppUrl } from './recording-whatsapp'

describe('buildRecordingWhatsAppUrl', () => {
  it('builds the exact pre-filled wa.me message', () => {
    const url = buildRecordingWhatsAppUrl({
      adminWhatsapp: '08012345678',
      username: 'chidi',
      tournamentTitle: 'DLS Cup 4',
      playerAName: 'Chidi',
      playerBName: 'Tunde',
    })
    expect(url).toBe(
      'https://wa.me/2348012345678?text=' +
        encodeURIComponent("Hi, I'm chidi submitting my recording for DLS Cup 4 - Chidi vs Tunde."),
    )
  })

  it('returns null when adminWhatsapp is null (env var unset)', () => {
    const url = buildRecordingWhatsAppUrl({
      adminWhatsapp: null,
      username: 'chidi',
      tournamentTitle: 'DLS Cup 4',
      playerAName: 'Chidi',
      playerBName: 'Tunde',
    })
    expect(url).toBeNull()
  })

  it('returns null for an unparseable admin WhatsApp number', () => {
    const url = buildRecordingWhatsAppUrl({
      adminWhatsapp: 'not-a-number',
      username: 'chidi',
      tournamentTitle: 'DLS Cup 4',
      playerAName: 'Chidi',
      playerBName: 'Tunde',
    })
    expect(url).toBeNull()
  })
})
