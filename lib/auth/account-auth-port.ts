import type { SupabaseClient, UserIdentity } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { createAdminClient } from '@/lib/supabase/admin'
import { createGoTrueUserApi } from '@/lib/mobile-api/gotrue-user'

export interface AccountIdentity {
  identityId: string
  provider: string
}
export interface PortError {
  code: string | null
  message: string
}

// The session-bound auth operations the account services need. Two adapters because the
// web holds a cookie session and mobile holds only a verified bearer token.
export interface AccountAuthPort {
  listIdentities(): Promise<AccountIdentity[] | null>
  updateEmail(email: string): Promise<PortError | null>
  unlinkIdentity(identityId: string): Promise<PortError | null>
  signOutOthers(): Promise<void>
}

const toPortError = (e: { message: string }): PortError => ({
  code: (e as { code?: string }).code ?? null,
  message: e.message,
})

export function supabaseSessionPort(supabase: SupabaseClient<Database>): AccountAuthPort {
  let raw: UserIdentity[] = []
  return {
    async listIdentities() {
      const { data, error } = await supabase.auth.getUserIdentities()
      if (error || !data) return null
      raw = data.identities
      return raw.map((i) => ({ identityId: i.identity_id, provider: i.provider }))
    },
    async updateEmail(email) {
      const { error } = await supabase.auth.updateUser({ email })
      return error ? toPortError(error) : null
    },
    async unlinkIdentity(identityId) {
      const identity = raw.find((i) => i.identity_id === identityId)
      if (!identity) return { code: 'identity_not_found', message: 'identity not found' }
      const { error } = await supabase.auth.unlinkIdentity(identity)
      return error ? toPortError(error) : null
    },
    async signOutOthers() {
      await supabase.auth.signOut({ scope: 'others' })
    },
  }
}

export function bearerPort(args: {
  accessToken: string
  userId: string
  admin: ReturnType<typeof createAdminClient>
  api?: ReturnType<typeof createGoTrueUserApi>
}): AccountAuthPort {
  const api = args.api ?? createGoTrueUserApi(args.accessToken)
  const fromResult = (r: Awaited<ReturnType<typeof api.updateEmail>>): PortError | null =>
    r.ok ? null : { code: r.error.code, message: r.error.message }
  return {
    async listIdentities() {
      const { data, error } = await args.admin.auth.admin.getUserById(args.userId)
      if (error || !data.user) return null
      return (data.user.identities ?? []).map((i) => ({ identityId: i.identity_id, provider: i.provider }))
    },
    async updateEmail(email) {
      return fromResult(await api.updateEmail(email))
    },
    async unlinkIdentity(identityId) {
      return fromResult(await api.unlinkIdentity(identityId))
    },
    async signOutOthers() {
      await api.signOutOthers()
    },
  }
}
