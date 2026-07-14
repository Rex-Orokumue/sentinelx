'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { notifyInApp } from '@/lib/notifications/inbox'
import { challengeSchema } from './schema'

export type FriendlyActionState = { error?: string; success?: boolean; matchId?: string } | undefined

export async function sendChallenge(
  _prev: FriendlyActionState,
  formData: FormData,
): Promise<FriendlyActionState> {
  const parsed = challengeSchema.safeParse({
    opponentId: formData.get('opponentId') ?? '',
    stakeAmount: formData.get('stakeAmount') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }
  if (user.id === parsed.data.opponentId) return { error: "You can't challenge yourself." }

  const stakeAmount = parsed.data.stakeAmount === '' ? null : parsed.data.stakeAmount

  const { data: created, error } = await supabase
    .from('friendly_matches')
    .insert({
      challenger_id: user.id,
      opponent_id: parsed.data.opponentId,
      stake_amount: stakeAmount,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error || !created) return { error: 'Could not send the challenge. Please try again.' }

  await notifyInApp({
    playerId: parsed.data.opponentId,
    type: 'friend_request', // reuses the friend_request bell type — a challenge is a social invite, same category
    title: stakeAmount ? 'Staked challenge received' : 'Friendly challenge received',
    body: stakeAmount
      ? `You've been challenged to a ₦${stakeAmount} staked friendly.`
      : "You've been challenged to a friendly match.",
    link: `/dashboard/friendlies/${created.id}`,
  })

  revalidatePath('/dashboard')
  return { success: true, matchId: created.id }
}

export async function acceptChallenge(
  _prev: FriendlyActionState,
  formData: FormData,
): Promise<FriendlyActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing challenge.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('opponent_id, status, stake_amount')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Challenge not found.' }
  if (fm.opponent_id !== user.id) return { error: 'Only the challenged player can accept.' }
  if (fm.status !== 'pending') return { error: 'This challenge was already resolved.' }

  const nextStatus = fm.stake_amount ? 'awaiting_payment' : 'active'
  const { error } = await supabase
    .from('friendly_matches')
    .update({ status: nextStatus })
    .eq('id', id)
  if (error) return { error: 'Could not accept. Please try again.' }

  revalidatePath('/dashboard')
  return { success: true, matchId: id }
}

export async function declineChallenge(
  _prev: FriendlyActionState,
  formData: FormData,
): Promise<FriendlyActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing challenge.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fm } = await supabase
    .from('friendly_matches')
    .select('opponent_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!fm) return { error: 'Challenge not found.' }
  if (fm.opponent_id !== user.id) return { error: 'Only the challenged player can decline.' }
  if (fm.status !== 'pending') return { error: 'This challenge was already resolved.' }

  const { error } = await supabase.from('friendly_matches').update({ status: 'declined' }).eq('id', id)
  if (error) return { error: 'Could not decline. Please try again.' }

  revalidatePath('/dashboard')
  return { success: true }
}
