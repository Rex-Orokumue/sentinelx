import { z } from 'zod'
import { authenticate, optionalAuth, type MobileCtx } from './auth'
import { ApiError, Errors, errorBody } from './errors'
import { gateVersion, parseBody } from './prelude'
import { runIdempotent } from './idempotency'

export type AuthLevel = 'public' | 'user' | 'staff' | 'admin'

export interface EndpointMeta {
  operationId: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  summary: string
  auth: AuthLevel
  body?: z.ZodTypeAny
  response: z.ZodTypeAny
  parameters?: OpenApiParameter[]
  // Set by defineStreamEndpoint: the 200 body is NDJSON, one event per line, not the { data } envelope.
  stream?: { events: z.ZodTypeAny; description: string }
}

export interface OpenApiParameter {
  name: string
  in: 'query' | 'path'
  required?: boolean
  description?: string
  schema: Record<string, unknown>
}

export interface Endpoint {
  meta: EndpointMeta
  handler: (req: Request, context?: { params: Record<string, string> }) => Promise<Response>
}

const HEADERS = { 'x-api-version': '1' }

function json(status: number, payload: unknown, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cacheControl, ...HEADERS },
  })
}

export function defineEndpoint<
  A extends AuthLevel,
  TBody extends z.ZodTypeAny = z.ZodUndefined,
  TRes extends z.ZodTypeAny = z.ZodTypeAny,
>(def: {
  operationId: string
  method: EndpointMeta['method']
  path: string
  summary: string
  auth: A
  body?: TBody
  response: TRes
  parameters?: OpenApiParameter[]
  cacheControl?: string
  skipVersionGate?: boolean
  idempotent?: boolean
  handler: (input: {
    ctx: A extends 'public' ? MobileCtx | null : MobileCtx
    body: z.infer<TBody>
    req: Request
    params: Record<string, string>
  }) => Promise<z.infer<TRes>>
}): Endpoint {
  const meta: EndpointMeta = {
    operationId: def.operationId,
    method: def.method,
    path: def.path,
    summary: def.summary,
    auth: def.auth,
    body: def.body,
    response: def.response,
    parameters: def.parameters,
  }

  async function handler(req: Request, context?: { params: Record<string, string> }): Promise<Response> {
    try {
      gateVersion(req, def.skipVersionGate)

      let ctx: MobileCtx | null
      if (def.auth === 'public') {
        ctx = await optionalAuth(req)
      } else {
        ctx = await authenticate(req)
        if ((def.auth === 'staff' && !ctx.isStaff) || (def.auth === 'admin' && !ctx.isAdmin)) {
          throw Errors.forbidden()
        }
      }

      const body: unknown = def.body ? await parseBody(req, def.body) : undefined

      const runOnce = async (): Promise<{ status: number; body: unknown }> => {
        try {
          const result = await def.handler({ ctx: ctx as never, body: body as never, req, params: context?.params ?? {} })
          // Enforces the published contract at runtime: a drifting handler 500s in dev/CI, not in a user's hand.
          const data = def.response.parse(result)
          return { status: 200, body: { data } }
        } catch (e) {
          if (e instanceof ApiError) return { status: e.status, body: errorBody(e) }
          console.error('[mobile-api] unhandled', { path: def.path, message: e instanceof Error ? e.message : String(e) })
          return { status: 500, body: { error: { code: 'internal', message: 'Something went wrong.' } } }
        }
      }

      if (def.idempotent) {
        const key = req.headers.get('idempotency-key')
        if (!key) throw Errors.idempotencyKeyRequired()
        const userId = (ctx as MobileCtx).userId
        const outcome = await runIdempotent(
          (ctx as MobileCtx).admin,
          { key, userId, route: new URL(req.url).pathname },
          runOnce,
        )
        if ('conflict' in outcome) throw Errors.idempotencyInProgress()
        return json(outcome.status, outcome.body, def.cacheControl)
      }

      const outcome = await runOnce()
      return json(outcome.status, outcome.body, def.cacheControl)
    } catch (e) {
      if (e instanceof ApiError) return json(e.status, errorBody(e))
      console.error('[mobile-api] unhandled', { path: def.path, message: e instanceof Error ? e.message : String(e) })
      return json(500, { error: { code: 'internal', message: 'Something went wrong.' } })
    }
  }

  return { meta, handler }
}
