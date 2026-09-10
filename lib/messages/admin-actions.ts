'use server'
import { revalidatePath } from 'next/cache'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export type AdminActionState = { error?: string } | undefined

export async function resolveDmReport(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const ctx = await requireStaff()
  const id = String(formData.get('id') ?? '')
  const deleteMessageId = String(formData.get('deleteMessageId') ?? '') || null
  if (!id) return { error: 'Missing report.' }

  const admin = createAdminClient()
  if (deleteMessageId) {
    const { error: delErr } = await admin.from('dm_messages').delete().eq('id', deleteMessageId)
    if (delErr) return { error: 'Could not delete the message.' }
  }
  const { error } = await admin
    .from('dm_reports')
    .update({ resolved_at: new Date().toISOString(), resolved_by: ctx.userId })
    .eq('id', id)
  if (error) return { error: 'Could not resolve the report.' }

  revalidatePath('/admin/messages')
  return undefined
}

export async function setMessagingMuted(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const ctx = await requireStaff()
  const playerId = String(formData.get('playerId') ?? '')
  const muted = String(formData.get('muted') ?? '') === 'true'
  if (!playerId) return { error: 'Missing player.' }

  const admin = createAdminClient()
  if (muted) {
    const { error } = await admin
      .from('dm_muted_players')
      .upsert({ player_id: playerId, muted_by: ctx.userId }, { onConflict: 'player_id', ignoreDuplicates: true })
    if (error) return { error: 'Could not mute this player.' }
  } else {
    const { error } = await admin.from('dm_muted_players').delete().eq('player_id', playerId)
    if (error) return { error: 'Could not unmute this player.' }
  }
  revalidatePath('/admin/messages')
  return undefined
}
