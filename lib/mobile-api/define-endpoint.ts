import { z } from 'zod'
import { authenticate, optionalAuth, type MobileCtx } from './auth'
import { ApiError, Errors, errorBody } from './errors'
import { compareVersions } from './version'

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
  handler: (req: Request) => Promise<Response>
}

const HEADERS = { 'x-api-version': '1' }

function json(status: number, payload: unknown, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cacheControl, ...HEADERS },
  })
}

// First issue per path wins; messages are the shared errorCode strings the web already uses.
function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!(key in out)) out[key] = issue.message
  }
  return out
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
  handler: (input: {
    ctx: A extends 'public' ? MobileCtx | null : MobileCtx
    body: z.infer<TBody>
    req: Request
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

  async function handler(req: Request): Promise<Response> {
    try {
      const appVersion = req.headers.get('x-app-version')
      const min = process.env.MOBILE_MIN_APP_VERSION ?? '0.0.0'
      if (!def.skipVersionGate && appVersion && compareVersions(appVersion, min) < 0) {
        throw Errors.upgradeRequired(min)
      }

      let ctx: MobileCtx | null
      if (def.auth === 'public') {
        ctx = await optionalAuth(req)
      } else {
        ctx = await authenticate(req)
        if ((def.auth === 'staff' && !ctx.isStaff) || (def.auth === 'admin' && !ctx.isAdmin)) {
          throw Errors.forbidden()
        }
      }

      let body: unknown = undefined
      if (def.body) {
        const raw = await req.json().catch(() => undefined)
        const parsed = def.body.safeParse(raw)
        if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error))
        body = parsed.data
      }

      const result = await def.handler({ ctx: ctx as never, body: body as never, req })
      // Enforces the published contract at runtime: a drifting handler 500s in dev/CI, not in a user's hand.
      const data = def.response.parse(result)
      return json(200, { data }, def.cacheControl)
    } catch (e) {
      if (e instanceof ApiError) return json(e.status, errorBody(e))
      console.error('[mobile-api] unhandled', { path: def.path, message: e instanceof Error ? e.message : String(e) })
      return json(500, { error: { code: 'internal', message: 'Something went wrong.' } })
    }
  }

  return { meta, handler }
}
