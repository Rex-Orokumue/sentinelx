import { describe, it, expect, vi } from 'vitest'
import { performSetLocale, isSupportedLocale } from './locale-service'

function admin(error: { message: string } | null = null, onUpdate?: (patch: unknown, id: string) => void) {
  return {
    from: () => ({ update: (patch: unknown) => ({ eq: async (_c: string, id: string) => { onUpdate?.(patch, id); return { error } } }) }),
  } as never
}

describe('isSupportedLocale', () => {
  it.each(['en', 'fr', 'pcm'])('accepts %s', (l) => expect(isSupportedLocale(l)).toBe(true))
  it.each(['EN', 'pt', '', 'en-US', null, undefined, 3])('rejects %j', (l) => expect(isSupportedLocale(l)).toBe(false))
})

describe('performSetLocale', () => {
  it('writes the locale for the caller only', async () => {
    const onUpdate = vi.fn()
    const r = await performSetLocale(admin(null, onUpdate), 'u1', 'pcm')
    expect(r).toEqual({ ok: true, locale: 'pcm' })
    expect(onUpdate).toHaveBeenCalledWith({ locale: 'pcm' }, 'u1')
  })

  it('rejects an unknown locale without writing', async () => {
    const onUpdate = vi.fn()
    const r = await performSetLocale(admin(null, onUpdate), 'u1', 'de')
    expect(r).toEqual({ ok: false, reason: 'invalid_locale' })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('reports a failed write', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await performSetLocale(admin({ message: 'x' }), 'u1', 'fr')
    expect(r).toEqual({ ok: false, reason: 'save_failed' })
    spy.mockRestore()
  })
})
