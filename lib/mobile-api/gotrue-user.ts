// Session-scoped GoTrue calls made with the caller's own access token.
//
// ctx.userClient cannot do these: it carries the bearer in a global header but has no
// session (persistSession is off), so supabase-js's updateUser / unlinkIdentity / signOut
// throw AuthSessionMissingError on it. The REST endpoints accept the bearer directly.
export interface GoTrueError {
  status: number
  code: string | null
  message: string
}
export type GoTrueResult = { ok: true } | { ok: false; error: GoTrueError }

export function createGoTrueUserApi(accessToken: string, fetchImpl: typeof fetch = fetch) {
  async function call(method: 'PUT' | 'DELETE' | 'POST', path: string, body?: unknown): Promise<GoTrueResult> {
    const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`
    try {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (res.ok) return { ok: true }
      let payload: { error_code?: unknown; code?: unknown; msg?: unknown; message?: unknown } = {}
      try {
        payload = (await res.json()) as typeof payload
      } catch {
        // non-JSON error body: fall through with status text
      }
      const code =
        typeof payload.error_code === 'string' ? payload.error_code : typeof payload.code === 'string' ? payload.code : null
      const message =
        typeof payload.msg === 'string' ? payload.msg : typeof payload.message === 'string' ? payload.message : res.statusText
      return { ok: false, error: { status: res.status, code, message } }
    } catch (e) {
      return { ok: false, error: { status: 0, code: null, message: e instanceof Error ? e.message : String(e) } }
    }
  }

  return {
    updateEmail: (email: string) => call('PUT', '/user', { email }),
    unlinkIdentity: (identityId: string) => call('DELETE', `/user/identities/${encodeURIComponent(identityId)}`),
    signOutOthers: () => call('POST', '/logout?scope=others'),
  }
}
