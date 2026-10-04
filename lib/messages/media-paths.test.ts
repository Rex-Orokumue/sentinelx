import { describe, it, expect } from 'vitest'
import { isOwnMediaPath } from './media-paths'

const U = '11111111-1111-4111-8111-111111111111'
const V = '22222222-2222-4222-8222-222222222222'

describe('isOwnMediaPath', () => {
  it('accepts <userId>/<file>', () => expect(isOwnMediaPath(`${U}/a1.jpg`, U)).toBe(true))
  it('rejects another user folder', () => expect(isOwnMediaPath(`${V}/a1.jpg`, U)).toBe(false))
  it('rejects traversal', () => {
    expect(isOwnMediaPath(`${U}/../${V}/a.jpg`, U)).toBe(false)
    expect(isOwnMediaPath(`${U}//a.jpg`, U)).toBe(false)
    expect(isOwnMediaPath(`${U}/..`, U)).toBe(false)
  })
  it('rejects a full URL, a bare file and an empty string', () => {
    expect(isOwnMediaPath(`https://x.test/${U}/a.jpg`, U)).toBe(false)
    expect(isOwnMediaPath('a.jpg', U)).toBe(false)
    expect(isOwnMediaPath('', U)).toBe(false)
  })
})
