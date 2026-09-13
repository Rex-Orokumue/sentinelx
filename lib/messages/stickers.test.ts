import { describe, it, expect } from 'vitest'
import { STICKER_PACK, isValidStickerId, stickerById } from './stickers'

describe('isValidStickerId', () => {
  it('accepts every id in the pack', () => {
    for (const s of STICKER_PACK) expect(isValidStickerId(s.id)).toBe(true)
  })

  it('rejects an id not in the pack', () => {
    expect(isValidStickerId('not-a-real-sticker')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidStickerId('')).toBe(false)
  })
})

describe('stickerById', () => {
  it('returns the sticker for a known id', () => {
    expect(stickerById('gg')).toEqual({ id: 'gg', emoji: '🎮', label: 'GG' })
  })

  it('returns undefined for an unknown id', () => {
    expect(stickerById('nope')).toBeUndefined()
  })
})
