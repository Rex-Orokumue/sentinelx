import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    const query: unknown = new Proxy(
      {},
      { get: (_t, key) => (key === 'then' ? (resolve: (v: unknown) => void) => resolve({ data: null }) : () => query) },
    )
    return { from: () => query }
  },
}))

import { generateMetadata } from './page'

describe('home page share image', () => {
  it('has the site default image for Open Graph and Twitter', async () => {
    const metadata = await generateMetadata({ params: { locale: 'en' } } as never)
    expect(metadata.openGraph?.images).toEqual([DEFAULT_OG_IMAGE])
    expect(metadata.twitter?.images).toEqual([DEFAULT_OG_IMAGE])
  })
})
