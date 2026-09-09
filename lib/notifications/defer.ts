import { waitUntil } from '@vercel/functions'

// The interop symbol Vercel puts its per-invocation request context on. Reading
// it directly is the only way to know whether waitUntil will actually do
// anything: `waitUntil` itself is `getContext().waitUntil?.(promise)` — an
// OPTIONAL call — so outside a live invocation it accepts the promise, does
// nothing with it, and returns undefined. Indistinguishable from success, and
// it would silently drop every notification in `next dev` and in tests.
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')

function platformCanHoldWork(): boolean {
  const holder = (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] as
    | { get?: () => { waitUntil?: unknown } | undefined }
    | undefined
  return typeof holder?.get?.()?.waitUntil === 'function'
}

// Hands background notification work to the platform so it survives the
// response.
//
// WHY THIS EXISTS. Every push used to be fired as a bare floating promise —
// `void pushToPlayer(...)` — and on Vercel that silently loses them. The
// instance is frozen the moment a Server Action returns its response; an
// unawaited promise is suspended mid-flight and only resumes if that same warm
// instance happens to serve another request later. Production caught it
// red-handed on 2026-09-07: a result submitted at 21:57 sent nothing, then at
// 22:02 its push executed inside an unrelated `GET /tournaments` and failed
// with `messaging/unknown-error` — the FCM connection had been torn down while
// the instance slept. Sometimes the promise won the race and the push arrived;
// sometimes it didn't. That is exactly the intermittency players reported.
//
// The in-app bell never showed the bug because a single Supabase insert is
// fast enough to finish before the freeze. FCM's OAuth handshake is not.
//
// `waitUntil` is the primitive built for this: it registers the promise with
// the platform, which keeps the instance alive until it settles, and returns
// immediately — so the player's action stays fast AND the push actually sends.
//
// Off-platform the work runs inline instead, so it still happens; the latency
// just lands on the request. If Vercel ever changes how the context is exposed,
// detection fails closed to that same inline path — slower, never silent.
export async function deferNotification(work: Promise<unknown>): Promise<void> {
  // Caught up front, not at the call site: once the platform owns the promise
  // it settles outside any caller's stack, where a rejection would surface as
  // an unhandled rejection and take the instance down with it. Notification
  // work is best-effort by contract — a failed push must never reach the action
  // that triggered it.
  const settled = Promise.resolve(work).then(
    () => undefined,
    (err) => {
      console.error('[notify] deferred notification work failed (non-blocking)', err)
    },
  )

  // Synchronous on purpose — see the "registers synchronously" test. Callers
  // that still write `void notifyStaff(...)` are only safe because the handoff
  // has already happened by the time the call returns.
  if (platformCanHoldWork()) {
    waitUntil(settled)
    return
  }

  await settled
}
