import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import type { MobileCtx } from '../auth'
import { profileEditSchema } from '@/lib/profile/schema'
import { performUpdateProfile, type UpdateProfileErrorCode } from '@/lib/profile/update-profile-service'
import { ApiError } from '../errors'

const meResponse = z.object({
  id: z.string(),
  email: z.string().nullable(),
  roles: z.array(z.string()),
  isStaff: z.boolean(),
  isAdmin: z.boolean(),
  profile: z
    .object({
      username: z.string().nullable(),
      displayName: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      whatsappNumber: z.string().nullable(),
      country: z.string().nullable(),
      locale: z.string().nullable(),
      membershipTier: z.string().nullable(),
      kycVerified: z.boolean(),
      deletionRequestedAt: z.string().nullable(),
    })
    .nullable(),
})

interface ProfileRow {
  username: string | null
  display_name: string | null
  avatar_url: string | null
  whatsapp_number: string | null
  country: string | null
  locale: string | null
  membership_tier: string | null
  kyc_verified: boolean
  deletion_requested_at: string | null
}

export function toMeResponse(ctx: Pick<MobileCtx, 'userId' | 'email' | 'roles' | 'isStaff' | 'isAdmin'>, row: ProfileRow | null) {
  return {
    id: ctx.userId,
    email: ctx.email,
    roles: ctx.roles as string[],
    isStaff: ctx.isStaff,
    isAdmin: ctx.isAdmin,
    profile: row && {
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      whatsappNumber: row.whatsapp_number,
      country: row.country,
      locale: row.locale,
      membershipTier: row.membership_tier,
      kycVerified: row.kyc_verified,
      deletionRequestedAt: row.deletion_requested_at,
    },
  }
}

export const meEndpoint = defineEndpoint({
  operationId: 'getMe',
  method: 'GET',
  path: '/me',
  summary: 'The signed-in user, their roles (drives the role-aware Admin section) and own profile.',
  auth: 'user',
  response: meResponse,
  handler: async ({ ctx }) => {
    // Own row only, id from the verified token. Service role because whatsapp_number and
    // deletion_requested_at are private columns (plan 2026-09-18-mobile-phase0a-security-hardening.md).
    const { data } = await ctx.admin
      .from('profiles')
      .select('username, display_name, avatar_url, whatsapp_number, country, locale, membership_tier, kyc_verified, deletion_requested_at')
      .eq('id', ctx.userId)
      .maybeSingle()
    return toMeResponse(ctx, data)
  },
})

const updateProfileBody = profileEditSchema.extend({ avatarUrl: z.string().url().optional() })
const updateProfileResponse = z.object({ ok: z.literal(true) })

export function updateProfileErrorMessage(code: UpdateProfileErrorCode): string {
  const messages: Record<UpdateProfileErrorCode, string> = {
    username_taken: 'That username is already taken.',
    username_locked: 'Username has already been changed once.',
    save_failed: 'Could not save your profile. Please try again.',
  }
  return messages[code]
}

export const updateProfileEndpoint = defineEndpoint({
  operationId: 'patchMeProfile',
  method: 'PATCH',
  path: '/me/profile',
  summary: "Update the signed-in player's own profile (display name, bio, country, one-time username change, avatar).",
  auth: 'user',
  body: updateProfileBody,
  response: updateProfileResponse,
  handler: async ({ ctx, body }) => {
    const result = await performUpdateProfile(ctx.userClient, ctx.admin, ctx.userId, body)
    if (!result.ok) throw new ApiError(400, result.errorCode, updateProfileErrorMessage(result.errorCode))
    return { ok: true as const }
  },
})
