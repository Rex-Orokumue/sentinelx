import { describe, it, expect } from 'vitest'
import { matchEditSchema } from './edit-schema'

const valid = {
  schedulingMode: 'timed' as const,
  scheduledAt: '2026-08-01T18:00',
  scheduledDate: '',
  streamUrl: 'https://youtu.be/abcdefghijk',
  replayUrl: '',
}

describe('matchEditSchema', () => {
  it('accepts a schedule + youtube stream and an empty replay', () => {
    expect(matchEditSchema.safeParse(valid).success).toBe(true)
  })
  it('accepts all-empty fields (everything is clearable)', () => {
    expect(
      matchEditSchema.safeParse({
        schedulingMode: 'timed',
        scheduledAt: '',
        scheduledDate: '',
        streamUrl: '',
        replayUrl: '',
      }).success,
    ).toBe(true)
  })
  it('accepts a watch?v= url', () => {
    expect(
      matchEditSchema.safeParse({
        ...valid,
        streamUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
      }).success,
    ).toBe(true)
  })
  it('rejects a non-youtube stream url', () => {
    expect(
      matchEditSchema.safeParse({ ...valid, streamUrl: 'https://drive.google.com/file/d/x' })
        .success,
    ).toBe(false)
  })
  it('rejects a non-youtube replay url', () => {
    expect(matchEditSchema.safeParse({ ...valid, replayUrl: 'https://example.com/clip' }).success).toBe(
      false,
    )
  })
  it('rejects a malformed scheduledAt', () => {
    expect(matchEditSchema.safeParse({ ...valid, scheduledAt: 'soon' }).success).toBe(false)
  })
})

describe('matchEditSchema — full-day mode', () => {
  it('accepts full_day mode with a valid date and no scheduledAt', () => {
    const r = matchEditSchema.safeParse({
      schedulingMode: 'full_day',
      scheduledAt: '',
      scheduledDate: '2026-08-01',
      streamUrl: '',
      replayUrl: '',
    })
    expect(r.success).toBe(true)
  })

  it('accepts timed mode with a valid scheduledAt and no scheduledDate', () => {
    const r = matchEditSchema.safeParse({
      schedulingMode: 'timed',
      scheduledAt: '2026-08-01T18:00',
      scheduledDate: '',
      streamUrl: '',
      replayUrl: '',
    })
    expect(r.success).toBe(true)
  })

  it('rejects an invalid schedulingMode', () => {
    const r = matchEditSchema.safeParse({
      schedulingMode: 'sometimes',
      scheduledAt: '',
      scheduledDate: '',
      streamUrl: '',
      replayUrl: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects a malformed scheduledDate', () => {
    const r = matchEditSchema.safeParse({
      schedulingMode: 'full_day',
      scheduledAt: '',
      scheduledDate: 'August 1st',
      streamUrl: '',
      replayUrl: '',
    })
    expect(r.success).toBe(false)
  })
})
