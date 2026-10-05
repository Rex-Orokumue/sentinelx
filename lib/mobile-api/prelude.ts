import { z } from 'zod'
import { Errors } from './errors'
import { compareVersions } from './version'

// Shared by defineEndpoint and defineStreamEndpoint so both gate versions and validate bodies identically.

export function gateVersion(req: Request, skip = false): void {
  const appVersion = req.headers.get('x-app-version')
  const min = process.env.MOBILE_MIN_APP_VERSION ?? '0.0.0'
  if (!skip && appVersion && compareVersions(appVersion, min) < 0) throw Errors.upgradeRequired(min)
}

// First issue per path wins; messages are the shared errorCode strings the web already uses.
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!(key in out)) out[key] = issue.message
  }
  return out
}

export async function parseBody<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  const raw = await req.json().catch(() => undefined)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw Errors.validation(fieldErrors(parsed.error))
  return parsed.data
}
