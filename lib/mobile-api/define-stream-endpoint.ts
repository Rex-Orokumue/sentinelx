import { z } from 'zod'
import { authenticate, strictOptionalAuth, type MobileCtx } from './auth'
import { ApiError, errorBody } from './errors'
import { gateVersion, parseBody } from './prelude'
import type { Endpoint, EndpointMeta } from './define-endpoint'

const HEADERS = { 'x-api-version': '1' }
const json = (status: number, payload: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...HEADERS, ...extra },
  })

// A POST whose 200 body is NDJSON: one validated event per line, no { data } envelope. Anything that can fail
// BEFORE the first byte (version gate, auth, body, admission) is thrown by the handler and answered with the normal
// JSON error envelope and status, so a client can branch on the status code. After the first byte, failures are
// terminal events inside the stream. 'public' means signed-out callers are allowed, but a present-and-invalid bearer
// is still 401 (strictOptionalAuth), never a silent downgrade.
export function defineStreamEndpoint<TBody extends z.ZodTypeAny, TEvent extends z.ZodTypeAny>(def: {
  operationId: string
  path: string
  summary: string
  auth: 'public' | 'user'
  body: TBody
  events: TEvent
  description: string
  handler: (input: {
    ctx: MobileCtx | null
    body: z.infer<TBody>
    req: Request
    signal: AbortSignal
  }) => Promise<AsyncIterable<z.infer<TEvent>>>
}): Endpoint {
  const meta: EndpointMeta = {
    operationId: def.operationId,
    method: 'POST',
    path: def.path,
    summary: def.summary,
    auth: def.auth,
    body: def.body,
    response: def.events,
    stream: { events: def.events, description: def.description },
  }

  async function handler(req: Request): Promise<Response> {
    try {
      gateVersion(req)
      const ctx = def.auth === 'user' ? await authenticate(req) : await strictOptionalAuth(req)
      const body = await parseBody(req, def.body)
      const ac = new AbortController()
      req.signal?.addEventListener('abort', () => ac.abort())
      const source = await def.handler({ ctx, body, req, signal: ac.signal })
      const iterator = source[Symbol.asyncIterator]()
      const encoder = new TextEncoder()
      const line = (v: unknown) => encoder.encode(JSON.stringify(v) + '\n')
      let cancelled = false
      // Never awaited: a generator stuck on an upstream call only finishes once the abort lands.
      const release = () => { void Promise.resolve(iterator.return?.(undefined as never)).catch(() => {}) }

      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { value, done } = await iterator.next()
            if (cancelled) return
            if (done) { controller.close(); return }
            const parsed = def.events.safeParse(value)
            if (!parsed.success) {
              controller.enqueue(line({ t: 'error', code: 'internal' }))
              controller.close()
              release()
              return
            }
            controller.enqueue(line(parsed.data))
          } catch {
            if (cancelled) return
            try {
              controller.enqueue(line({ t: 'error', code: 'internal' }))
              controller.close()
            } catch {}
          }
        },
        cancel() {
          cancelled = true
          ac.abort()
          release()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', ...HEADERS },
      })
    } catch (e) {
      if (e instanceof ApiError) {
        const retry = e.fields?.retryAfterSeconds
        return json(e.status, errorBody(e), retry ? { 'retry-after': retry } : {})
      }
      console.error('[mobile-api] unhandled', { path: def.path, message: e instanceof Error ? e.message : String(e) })
      return json(500, { error: { code: 'internal', message: 'Something went wrong.' } })
    }
  }
  return { meta, handler }
}
