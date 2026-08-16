'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export type ChallengeActionState = { error?: string; success?: boolean } | undefined

const CHALLENGE_TYPES = ['matches_played', 'matches_won', 'post_created', 'reactions_given'] as const

const challengeSchema = z.object({
  slug: z.string().min(2).regex(/^[a-z0-9_]+$/, 'Slug must be lowercase letters, numbers, underscores only.'),
  title: z.string().min(2),
  description: z.string().min(2),
  challengeType: z.enum(CHALLENGE_TYPES),
  goal: z.coerce.number().int().positive(),
  coinReward: z.coerce.number().int().min(0),
  xpReward: z.coerce.number().int().min(0),
})

export async function createChallenge(_prev: ChallengeActionState, formData: FormData): Promise<ChallengeActionState> {
  await requireAdmin()
  const parsed = challengeSchema.safeParse({
    slug: formData.get('slug'),
    title: formData.get('title'),
    description: formData.get('description'),
    challengeType: formData.get('challengeType'),
    goal: formData.get('goal'),
    coinReward: formData.get('coinReward'),
    xpReward: formData.get('xpReward'),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const admin = createAdminClient()
  const { error } = await admin.from('community_challenges').insert({
    slug: d.slug,
    title: d.title,
    description: d.description,
    challenge_type: d.challengeType,
    goal: d.goal,
    coin_reward: d.coinReward,
    xp_reward: d.xpReward,
  })
  if (error) {
    if ((error as { code?: string }).code === '23505') return { error: 'That slug is already in use.' }
    return { error: 'Could not create the challenge.' }
  }
  revalidatePath('/admin/community/challenges')
  revalidatePath('/community')
  return { success: true }
}

// Rewards/goal are editable; slug and challenge_type are not — changing
// challenge_type mid-week would silently orphan in-progress
// player_challenge_progress rows tracked against the old type.
export async function updateChallenge(_prev: ChallengeActionState, formData: FormData): Promise<ChallengeActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing challenge.' }

  const parsed = z
    .object({
      title: z.string().min(2),
      description: z.string().min(2),
      goal: z.coerce.number().int().positive(),
      coinReward: z.coerce.number().int().min(0),
      xpReward: z.coerce.number().int().min(0),
    })
    .safeParse({
      title: formData.get('title'),
      description: formData.get('description'),
      goal: formData.get('goal'),
      coinReward: formData.get('coinReward'),
      xpReward: formData.get('xpReward'),
    })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const d = parsed.data

  const admin = createAdminClient()
  await admin
    .from('community_challenges')
    .update({ title: d.title, description: d.description, goal: d.goal, coin_reward: d.coinReward, xp_reward: d.xpReward })
    .eq('id', id)
  revalidatePath('/admin/community/challenges')
  revalidatePath('/community')
  return { success: true }
}

export async function toggleChallengeActive(_prev: ChallengeActionState, formData: FormData): Promise<ChallengeActionState> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const active = formData.get('active') === 'true'
  if (!id) return { error: 'Missing challenge.' }

  const admin = createAdminClient()
  await admin.from('community_challenges').update({ active: !active }).eq('id', id)
  revalidatePath('/admin/community/challenges')
  revalidatePath('/community')
  return { success: true }
}
