import { describe, it, expect, vi } from 'vitest'

const maybeSingle = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}))

describe('checkUsernameAvailability', () => {
  it('returns "taken" when a matching profile exists', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: 'u1' } })
    const { checkUsernameAvailability } = await import('./checkUsernameAvailability')
    await expect(checkUsernameAvailability('davidokafor')).resolves.toBe('taken')
  })

  it('returns "available" when no profile matches', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null })
    const { checkUsernameAvailability } = await import('./checkUsernameAvailability')
    await expect(checkUsernameAvailability('davidokafor')).resolves.toBe('available')
  })

  // The root cause of the reported bug: this query used to have no bound on
  // it at all, running client-side with no Vercel function ceiling to kill
  // it — a stalled Supabase request left the Continue button disabled
  // (status stuck on 'checking') indefinitely. Mirrors the bounded-check
  // tests in lib/supabase/middleware.test.ts. Fake timers so a
  // "never resolves" mock doesn't block the suite for real wall-clock time.
  it('resolves to "unknown" instead of hanging when the lookup never resolves', async () => {
    vi.useFakeTimers()
    try {
      maybeSingle.mockImplementationOnce(() => new Promise(() => {})) // never resolves
      const { checkUsernameAvailability } = await import('./checkUsernameAvailability')
      const resultPromise = checkUsernameAvailability('davidokafor')
      await vi.runAllTimersAsync()
      await expect(resultPromise).resolves.toBe('unknown')
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves to "unknown" instead of throwing when the lookup rejects', async () => {
    maybeSingle.mockRejectedValueOnce(new Error('network error'))
    const { checkUsernameAvailability } = await import('./checkUsernameAvailability')
    await expect(checkUsernameAvailability('davidokafor')).resolves.toBe('unknown')
  })
})
