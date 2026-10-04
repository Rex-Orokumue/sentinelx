'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import * as service from './service'

// Thin wrappers: authenticate, call the shared service (also used by /api/mobile/v1), map the result to the
// `{ error?: string }` shape the web components already consume, and revalidate.
async function authed(): Promise<service.MessageCtx | null> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? { supabase, admin: createAdminClient(), userId: user.id } : null
}

const LOGIN = { error: 'Please log in.' }

export async function startConversation(otherId: string): Promise<{ threadId?: string; error?: string }> {
  const ctx = await authed()
  if (!ctx) return LOGIN
  const res = await service.startConversation(ctx, otherId)
  return res.ok ? { threadId: res.threadId } : { error: res.message }
}

export async function sendMessage(input: service.SendInput): Promise<{ threadId?: string; messageId?: string; error?: string }> {
  const ctx = await authed()
  if (!ctx) return LOGIN
  const res = await service.sendMessageCore(ctx, input)
  if (!res.ok) return { error: res.message }
  revalidatePath('/messages')
  revalidatePath(`/messages/${res.threadId}`)
  return { threadId: res.threadId, messageId: res.messageId }
}

export async function markAllThreadsDelivered(): Promise<void> {
  const ctx = await authed()
  if (!ctx) return
  await service.markAllDelivered(ctx)
}

export async function markThreadRead(threadId: string): Promise<void> {
  const ctx = await authed()
  if (!ctx) return
  await service.markThreadRead(ctx, threadId)
}

export async function blockUser(otherId: string): Promise<{ error?: string }> {
  const ctx = await authed()
  if (!ctx) return LOGIN
  const res = await service.blockPlayer(ctx, otherId)
  if (!res.ok) return { error: res.message }
  revalidatePath('/messages')
  return {}
}

export async function unblockUser(otherId: string): Promise<{ error?: string }> {
  const ctx = await authed()
  if (!ctx) return LOGIN
  const res = await service.unblockPlayer(ctx, otherId)
  if (!res.ok) return { error: res.message }
  revalidatePath('/messages')
  return {}
}

export async function reportConversation(input: {
  threadId: string
  messageId?: string
  reason: string
}): Promise<{ error?: string }> {
  const ctx = await authed()
  if (!ctx) return LOGIN
  const res = await service.reportThread(ctx, input)
  return res.ok ? {} : { error: res.message }
}

export async function editMessage(input: { messageId: string; body: string }): Promise<{ error?: string }> {
  const ctx = await authed()
  if (!ctx) return LOGIN
  const res = await service.editMessageCore(ctx, input)
  if (!res.ok) return { error: res.message }
  revalidatePath(`/messages/${res.threadId}`)
  return {}
}

export async function unsendMessage(messageId: string): Promise<{ error?: string }> {
  const ctx = await authed()
  if (!ctx) return LOGIN
  const res = await service.unsendMessageCore(ctx, messageId)
  if (!res.ok) return { error: res.message }
  revalidatePath(`/messages/${res.threadId}`)
  return {}
}

export async function forwardMessage(input: { messageId: string; toThreadId: string }): Promise<{ error?: string }> {
  const ctx = await authed()
  if (!ctx) return LOGIN
  const res = await service.forwardMessageCore(ctx, input)
  return res.ok ? {} : { error: res.message }
}
