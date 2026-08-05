import { computeTier, type MembershipTier } from './tiers'
import { notifyInApp } from '@/lib/notifications/inbox'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export interface AwardXpResult {
  newXp: number
  tierChanged: boolean
  newTier: MembershipTier
}

// XP is permanent — it never decreases (design doc §4.1). Recomputes and
// writes profiles.membership_tier on every award; fires an in-app
// tier_upgraded notification exactly once per tier crossing, never on every
// XP award (see the tierChanged guard below).
export async function awardXP(
  admin: Admin,
  playerId: string,
  xp: number,
  source: string,
  referenceId: string | null,
): Promise<AwardXpResult> {
  const { data: profile } = await admin
    .from('profiles')
    .select('xp, membership_tier')
    .eq('id', playerId)
    .maybeSingle()
  const currentXp = profile?.xp ?? 0
  const currentTier = (profile?.membership_tier ?? 'recruit') as MembershipTier

  const newXp = currentXp + xp
  const newTier = computeTier(newXp)
  const tierChanged = newTier !== currentTier

  await admin.from('profiles').update({ xp: newXp, membership_tier: newTier }).eq('id', playerId)
  await admin.from('xp_events').insert({ player_id: playerId, xp, source, reference_id: referenceId })

  if (tierChanged) {
    await notifyInApp({
      playerId,
      type: 'tier_upgraded',
      title: 'Membership tier up!',
      body: `You've reached ${newTier[0].toUpperCase()}${newTier.slice(1)} — ${newXp.toLocaleString()} XP.`,
      link: '/dashboard',
    })
  }

  return { newXp, tierChanged, newTier }
}
