import { describe, it, expect } from 'vitest'
import { matchEditSchema } from './edit-schema'

const valid = {
  scheduledAt: '2026-08-01T18:00',
  streamUrl: 'https://youtu.be/abcdefghijk',
  replayUrl: '',
}

describe('matchEditSchema', () => {
  it('accepts a schedule + youtube stream and an empty replay', () => {
    expect(matchEditSchema.safeParse(valid).success).toBe(true)
  })
  it('accepts all-empty fields (everything is clearable)', () => {
    expect(
      matchEditSchema.safeParse({ scheduledAt: '', streamUrl: '', replayUrl: '' }).success,
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
