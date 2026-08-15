'use server'
import { revalidatePath } from 'next/cache'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { postContentSchema } from './schema'
import { currentWeekStart } from './challenges'
import { awardCoins } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'

export type AdminActionState = { error?: string } | undefined

// Spec §11 "Create announcements" — always pinned above all other posts.
export async function createAnnouncement(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireStaff()
  const parsed = postContentSchema.safeParse(String(formData.get('content') ?? ''))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const imageUrl = String(formData.get('imageUrl') ?? '').trim() || null
  if (!parsed.data && !imageUrl) return { error: 'Write something first.' }

  const admin = createAdminClient()
  const { error } = await admin.from('community_posts').insert({
    author_id: null,
    content: parsed.data,
    image_url: imageUrl,
    post_type: 'announcement',
    is_pinned: true,
  })
  if (error) return { error: 'Could not create the announcement.' }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return undefined
}

export async function togglePin(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const pinned = formData.get('pinned') === 'true'
  if (!id) return { error: 'Missing post.' }

  const admin = createAdminClient()
  const { error } = await admin.from('community_posts').update({ is_pinned: pinned }).eq('id', id)
  if (error) return { error: 'Could not update the post.' }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return undefined
}

// Soft delete + reason (spec §11) — any post, any post_type.
export async function adminDeletePost(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireStaff()
  const id = String(formData.get('id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim() || null
  if (!id) return { error: 'Missing post.' }

  const admin = createAdminClient()
  const { error } = await admin.from('community_posts').update({ is_deleted: true, deleted_reason: reason }).eq('id', id)
  if (error) return { error: 'Could not delete the post.' }

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return undefined
}

export async function nominateBestPlay(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireStaff()
  const postId = String(formData.get('postId') ?? '')
  if (!postId) return { error: 'Missing post.' }

  const admin = createAdminClient()
  const { error } = await admin.from('best_play_nominations').insert({ post_id: postId, week_start: currentWeekStart() })
  if (error) return { error: 'Could not nominate this post.' }

  revalidatePath('/admin/community')
  revalidatePath('/community')
  return undefined
}

// Spec §9 step 3 — confirm the winner, award winner + runner-up, unlock the
// best_play_winner achievement (if not already), and post the winner
// announcement. Runner-up is whichever other nomination that week has the
// most votes (if any).
export async function confirmBestPlayWinner(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireStaff()
  const nominationId = String(formData.get('nominationId') ?? '')
  if (!nominationId) return { error: 'Missing nomination.' }

  const admin = createAdminClient()
  const { data: winnerNom } = await admin
    .from('best_play_nominations')
    .select('id, post_id, week_start, post:community_posts(author_id, content, author:profiles!community_posts_author_id_fkey(display_name, username))')
    .eq('id', nominationId)
    .maybeSingle()
  if (!winnerNom) return { error: 'Nomination not found.' }

  type PostRef = { author_id: string | null; content: string; author: { display_name: string | null; username: string | null } | { display_name: string | null; username: string | null }[] | null }
  const post = (Array.isArray(winnerNom.post) ? winnerNom.post[0] : winnerNom.post) as PostRef | null
  const winnerId = post?.author_id ?? null
  if (!winnerId) return { error: "This post has no author to award — it can't win Best Play." }

  const { error: markErr } = await admin.from('best_play_nominations').update({ is_winner: true }).eq('id', nominationId)
  if (markErr) return { error: 'Could not confirm the winner.' }

  await awardCoins(admin, winnerId, 500, 'best_play_winner', nominationId)
  await awardXP(admin, winnerId, 200, 'best_play_winner', nominationId)
  await unlockBestPlayAchievement(admin, winnerId, nominationId)

  await awardRunnerUp(admin, winnerNom.week_start, nominationId)

  const author = post ? (Array.isArray(post.author) ? post.author[0] : post.author) : null
  const winnerName = author?.display_name ?? author?.username ?? 'A player'
  await admin.from('community_posts').insert({
    author_id: null,
    post_type: 'announcement',
    content: `🎯 Best Play of the Week goes to ${winnerName}! Check out the winning moment below.`,
    reference_id: winnerNom.post_id,
    is_pinned: true,
  })

  revalidatePath('/community')
  revalidatePath('/admin/community')
  return undefined
}

async function unlockBestPlayAchievement(admin: ReturnType<typeof createAdminClient>, playerId: string, nominationId: string): Promise<void> {
  const { data: achievement } = await admin.from('achievements').select('id').eq('slug', 'best_play_winner').maybeSingle()
  if (!achievement) return
  const { error } = await admin.from('player_achievements').insert({ player_id: playerId, achievement_id: achievement.id })
  if (error) return // UNIQUE race or already unlocked — fine, the coin/XP award above already ran once per nomination
  void nominationId
}

async function awardRunnerUp(admin: ReturnType<typeof createAdminClient>, weekStart: string, winningNominationId: string): Promise<void> {
  const { data: others } = await admin
    .from('best_play_nominations')
    .select('id, post_id, post:community_posts(author_id)')
    .eq('week_start', weekStart)
    .neq('id', winningNominationId)
  if (!others || others.length === 0) return

  const { data: votes } = await admin
    .from('best_play_votes')
    .select('nomination_id')
    .in('nomination_id', others.map((o) => o.id))
  const countByNomination = new Map<string, number>()
  for (const v of votes ?? []) countByNomination.set(v.nomination_id, (countByNomination.get(v.nomination_id) ?? 0) + 1)

  let best: { id: string; postAuthorId: string | null; votes: number } | null = null
  for (const o of others) {
    type PostRef = { author_id: string | null } | { author_id: string | null }[] | null
    const post = o.post as PostRef
    const authorId = (Array.isArray(post) ? post[0]?.author_id : post?.author_id) ?? null
    const voteCount = countByNomination.get(o.id) ?? 0
    if (!best || voteCount > best.votes) best = { id: o.id, postAuthorId: authorId, votes: voteCount }
  }
  if (!best || !best.postAuthorId || best.votes === 0) return

  await awardCoins(admin, best.postAuthorId, 200, 'best_play_runner_up', best.id)
  await awardXP(admin, best.postAuthorId, 100, 'best_play_runner_up', best.id)
}
