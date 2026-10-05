import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import type { MobileCtx } from '../auth'
import { profileEditSchema } from '@/lib/profile/schema'
import { isOwnAvatarUrl } from '@/lib/profile/avatar-url'
import { performUpdateProfile, type UpdateProfileErrorCode } from '@/lib/profile/update-profile-service'
import { ApiError, Errors } from '../errors'
import { postgresUuidSchema } from '@/lib/validation/postgres-uuid'
import { bubbleSkinUrlFor } from '@/lib/store/cosmetics'

export const meResponse = z.object({
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
      // Server-owned onboarding gate input: null until the player completes the compulsory profile step.
      profileCompletedAt: z.string().nullable(),
      consentWhatsappUpdates: z.boolean(),
      gameInterests: z.array(postgresUuidSchema),
      // Mascot bubble skin: the equipped slug and its image as a relative path (same convention as frameUrl).
      equippedBubbleSkin: z.string().nullable(),
      bubbleSkinUrl: z.string().nullable(),
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
  profile_completed_at: string | null
  consent_whatsapp_updates: boolean
  equipped_bubble_skin?: string | null
}

export function toMeResponse(
  ctx: Pick<MobileCtx, 'userId' | 'email' | 'roles' | 'isStaff' | 'isAdmin'>,
  row: ProfileRow | null,
  gameInterestIds: string[] = [],
) {
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
      profileCompletedAt: row.profile_completed_at,
      consentWhatsappUpdates: row.consent_whatsapp_updates,
      gameInterests: gameInterestIds,
      equippedBubbleSkin: row.equipped_bubble_skin ?? null,
      bubbleSkinUrl: bubbleSkinUrlFor(row.equipped_bubble_skin) ?? null,
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
    const [{ data }, { data: interests }] = await Promise.all([
      ctx.admin
        .from('profiles')
        .select(
          'username, display_name, avatar_url, whatsapp_number, country, locale, membership_tier, kyc_verified, deletion_requested_at, profile_completed_at, consent_whatsapp_updates, equipped_bubble_skin',
        )
        .eq('id', ctx.userId)
        .maybeSingle(),
      ctx.admin.from('game_interest').select('game_id').eq('user_id', ctx.userId),
    ])
    return toMeResponse(ctx, data, (interests ?? []).map((r) => r.game_id))
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
    if (body.avatarUrl !== undefined && !isOwnAvatarUrl(body.avatarUrl, ctx.userId, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) {
      throw Errors.validation({ avatarUrl: 'invalid_avatar_url' })
    }
    const result = await performUpdateProfile(ctx.userClient, ctx.admin, ctx.userId, body)
    if (!result.ok) throw new ApiError(400, result.errorCode, updateProfileErrorMessage(result.errorCode))
    return { ok: true as const }
  },
})
