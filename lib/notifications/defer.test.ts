import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const waitUntil = vi.fn()
vi.mock('@vercel/functions', () => ({ waitUntil }))

const REQ_CONTEXT = Symbol.for('@vercel/request-context')

// Stands in for the request context Vercel puts on globalThis inside a live
// function invocation. Absent in vitest and `next dev`, which is the whole
// reason the fallback branch has to exist.
function withRequestContext(): void {
  ;(globalThis as Record<symbol, unknown>)[REQ_CONTEXT] = {
    get: () => ({ waitUntil: () => undefined }),
  }
}
function withoutRequestContext(): void {
  delete (globalThis as Record<symbol, unknown>)[REQ_CONTEXT]
}

// Resolves only when `release()` is called — lets a test assert that
// deferNotification returned *before* the work finished.
function pending(): { promise: Promise<void>; release: () => void; done: () => boolean } {
  let settled = false
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = () => {
      settled = true
      resolve()
    }
  })
  return { promise, release, done: () => settled }
}

describe('deferNotification', () => {
  beforeEach(() => {
    waitUntil.mockReset()
  })
  afterEach(() => {
    withoutRequestContext()
  })

  it('hands the work to the platform and returns without waiting for it', async () => {
    withRequestContext()
    const { promise, done } = pending()
    const { deferNotification } = await import('./defer')

    await deferNotification(promise)

    // The whole point: the caller's action is free to return while the push is
    // still in flight, because waitUntil keeps the instance alive for it.
    expect(done()).toBe(false)
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it('registers with the platform synchronously, before its own promise settles', async () => {
    // Load-bearing. Callers still write `void pushToPlayer(...)`, so the
    // handoff must already have happened by the time the call returns — if it
    // waited even one microtask, an un-awaited caller would race the freeze
    // all over again.
    withRequestContext()
    const { deferNotification } = await import('./defer')

    void deferNotification(Promise.resolve())

    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it('runs the work inline when there is no request context', async () => {
    // vitest, `next dev`, any non-Vercel host. waitUntil would be a silent
    // no-op there (getContext().waitUntil?.() — note the optional call), so
    // handing it the promise would simply drop the notification.
    withoutRequestContext()
    const { promise, release, done } = pending()
    release()
    const { deferNotification } = await import('./defer')

    await deferNotification(promise)

    expect(done()).toBe(true)
    expect(waitUntil).not.toHaveBeenCalled()
  })

  it('never throws into the caller when the work rejects', async () => {
    withoutRequestContext()
    const { deferNotification } = await import('./defer')

    await expect(deferNotification(Promise.reject(new Error('FCM down')))).resolves.toBeUndefined()
  })

  it('swallows a rejection that surfaces after the platform took the work', async () => {
    // The handed-off promise settles outside any caller's stack, where a
    // rejection becomes an unhandled rejection and takes the instance down.
    withRequestContext()
    const { deferNotification } = await import('./defer')

    await deferNotification(Promise.reject(new Error('FCM down')))

    const handed = waitUntil.mock.calls[0][0] as Promise<unknown>
    await expect(handed).resolves.toBeUndefined()
  })
})
