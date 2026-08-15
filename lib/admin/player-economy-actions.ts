'use server'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { awardCoins } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import { notifyInApp } from '@/lib/notifications/inbox'
import { validateGrantAmount } from './player-economy-validate'

export type EconomyActionState = { error?: string; success?: boolean } | undefined

async function readReason(formData: FormData): Promise<string | { error: string }> {
  const reason = String(formData.get('reason') ?? '').trim()
  if (!reason) return { error: 'Enter a reason for this action.' }
  return reason
}

export async function grantCoins(_prev: EconomyActionState, formData: FormData): Promise<EconomyActionState> {
  await requireAdmin()
  const playerId = String(formData.get('playerId') ?? '')
  const amount = Number(formData.get('amount'))
  const amountError = validateGrantAmount(amount)
  if (amountError) return { error: amountError }
  const reason = await readReason(formData)
  if (typeof reason !== 'string') return reason

  const admin = createAdminClient()
  await awardCoins(admin, playerId, amount, 'admin_grant', null, reason)
  await notifyInApp({
    playerId,
    type: 'wallet_credited',
    title: 'SX Coins granted',
    body: `+${amount} SX Coins: ${reason}`,
    link: '/dashboard',
  })
  revalidatePath(`/admin/players/${playerId}`)
  return { success: true }
}

export async function deductCoins(_prev: EconomyActionState, formData: FormData): Promise<EconomyActionState> {
  await requireAdmin()
  const playerId = String(formData.get('playerId') ?? '')
  const amount = Number(formData.get('amount'))
  const amountError = validateGrantAmount(amount)
  if (amountError) return { error: amountError }
  const reason = await readReason(formData)
  if (typeof reason !== 'string') return reason

  const admin = createAdminClient()
  await awardCoins(admin, playerId, -amount, 'admin_deduct', null, reason)
  revalidatePath(`/admin/players/${playerId}`)
  return { success: true }
}

export async function grantXp(_prev: EconomyActionState, formData: FormData): Promise<EconomyActionState> {
  await requireAdmin()
  const playerId = String(formData.get('playerId') ?? '')
  const amount = Number(formData.get('amount'))
  const amountError = validateGrantAmount(amount)
  if (amountError) return { error: amountError }
  const reason = await readReason(formData)
  if (typeof reason !== 'string') return reason

  const admin = createAdminClient()
  await awardXP(admin, playerId, amount, 'admin_grant', null)
  revalidatePath(`/admin/players/${playerId}`)
  return { success: true }
}

// Manual unlock is a correction tool — inserts the row directly, skipping
// XP/coin rewards (design doc §7.3: "for correction purposes").
export async function manuallyUnlockAchievement(
  _prev: EconomyActionState,
  formData: FormData,
): Promise<EconomyActionState> {
  await requireAdmin()
  const playerId = String(formData.get('playerId') ?? '')
  const achievementId = String(formData.get('achievementId') ?? '')
  if (!playerId || !achievementId) return { error: 'Missing player or achievement.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('player_achievements')
    .insert({ player_id: playerId, achievement_id: achievementId })
  if (error) {
    if ((error as { code?: string }).code === '23505') return { error: 'Player already has this achievement.' }
    console.error('[manuallyUnlockAchievement]', error)
    return { error: 'Could not unlock the achievement.' }
  }
  revalidatePath(`/admin/players/${playerId}`)
  return { success: true }
}
