import { describe, it, expect } from 'vitest'
import { transformedStorageUrl } from './avatar'

const SUPABASE_URL = 'https://itxubrkbropttfdackmi.supabase.co/storage/v1/object/public/avatars/u1/f1.png'

describe('transformedStorageUrl', () => {
  it('rewrites a Supabase Storage public-object URL to the image-transform endpoint', () => {
    const out = transformedStorageUrl(SUPABASE_URL, 240, 240)
    expect(out).toBe(
      'https://itxubrkbropttfdackmi.supabase.co/storage/v1/render/image/public/avatars/u1/f1.png?width=240&height=240&resize=cover',
    )
  })

  it('leaves a non-Supabase-Storage URL unchanged', () => {
    const other = 'https://example.com/some/image.png'
    expect(transformedStorageUrl(other, 240, 240)).toBe(other)
  })

  it('leaves an unparseable URL unchanged rather than throwing', () => {
    expect(transformedStorageUrl('not a url', 240, 240)).toBe('not a url')
  })
})
