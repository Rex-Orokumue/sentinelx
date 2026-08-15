'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reactionSchema, type ReactionType } from './schema'
import { incrementChallenge } from './challenges'

export type ToggleReactionResult = { error?: string } | undefined

// One reaction per player per post (post_reactions UNIQUE(post_id, player_id)).
// Tapping the same reaction again removes it; tapping a different one
// replaces it (spec §5.1). Only a brand-new reaction (no prior row) counts
// toward the "Hype Man" weekly challenge — switching or removing a reaction
// on a post already reacted to isn't a new "react to a post".
export async function toggleReaction(postId: string, reaction: ReactionType): Promise<ToggleReactionResult> {
  const parsed = reactionSchema.safeParse(reaction)
  if (!parsed.success || !postId) return { error: 'Invalid reaction.' }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Please log in to react.' }

  const { data: existing } = await supabase
    .from('post_reactions')
    .select('id, reaction')
    .eq('post_id', postId)
    .eq('player_id', user.id)
    .maybeSingle()

  if (existing?.reaction === parsed.data) {
    const { error } = await supabase.from('post_reactions').delete().eq('id', existing.id)
    if (error) return { error: 'Could not update your reaction.' }
    return undefined
  }

  if (existing) {
    const { error } = await supabase.from('post_reactions').update({ reaction: parsed.data }).eq('id', existing.id)
    if (error) return { error: 'Could not update your reaction.' }
    return undefined
  }

  const { error } = await supabase.from('post_reactions').insert({ post_id: postId, player_id: user.id, reaction: parsed.data })
  if (error) return { error: 'Could not save your reaction.' }

  const admin = createAdminClient()
  await incrementChallenge(admin, user.id, 'reactions_given')
  return undefined
}
