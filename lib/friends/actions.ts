'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { notifyInApp } from '@/lib/notifications/inbox'

export type FriendActionState = { error?: string; success?: boolean } | undefined

export async function sendFriendRequest(
  _prev: FriendActionState,
  formData: FormData,
): Promise<FriendActionState> {
  const recipientId = String(formData.get('recipientId') ?? '')
  if (!recipientId) return { error: 'Missing player.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }
  if (user.id === recipientId) return { error: "You can't friend yourself." }

  const { error } = await supabase
    .from('friends')
    .insert({ requester_id: user.id, recipient_id: recipientId, status: 'pending' })
  if (error) {
    // UNIQUE(requester_id, recipient_id) — a request already exists this direction.
    if ((error as { code?: string }).code === '23505') {
      return { error: 'You already sent a request to this player.' }
    }
    return { error: 'Could not send the request. Please try again.' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}

export async function acceptFriendRequest(
  _prev: FriendActionState,
  formData: FormData,
): Promise<FriendActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing request.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in.' }

  const { data: fr } = await supabase
    .from('friends')
    .select('requester_id, recipient_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!fr) return { error: 'Request not found.' }
  if (fr.recipient_id !== user.id) return { error: 'Only the recipient can accept this request.' }
  if (fr.status !== 'pending') return { error: 'This request was already resolved.' }

  const { error } = await supabase.from('friends').update({ status: 'accepted' }).eq('id', id)
  if (error) return { error: 'Could not accept the request. Please try again.' }

  await notifyInApp({
    playerId: fr.requester_id,
    type: 'friend_request',
    title: 'Friend request accepted',
    body: 'Your friend request was accepted.',
    link: '/dashboard',
  })

  revalidatePath('/dashboard')
  return { success: true }
}

// Covers both "decline a pending request" and "remove an accepted friend" —
// same DELETE, same participant-or-recipient ownership check, RLS enforces
// the actual row-level permission either way.
export async function removeFriend(
  _prev: FriendActionState,
  formData: FormData,
): Promise<FriendActionState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing request.' }

  const supabase = createClient()
  const { error } = await supabase.from('friends').delete().eq('id', id)
  if (error) return { error: 'Could not remove. Please try again.' }

  revalidatePath('/dashboard')
  return { success: true }
}
