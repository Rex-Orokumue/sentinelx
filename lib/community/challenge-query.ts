import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/format'
import { currentWeekStart } from './challenges'

export interface ChallengeProgressView {
  slug: string
  title: string
  description: string
  goal: number
  progress: number
  completed: boolean
  coinReward: number
  xpReward: number
}

// Spec §8 — the 4 weekly challenges + this player's current-week progress,
// fetched in parallel with the feed query (not a waterfall). Null for a
// guest viewer — progress is per-player, there's nothing to show.
export async function fetchChallengeWidget(viewerId: string | null): Promise<{ weekLabel: string; challenges: ChallengeProgressView[] } | null> {
  if (!viewerId) return null
  const supabase = createClient()
  const weekStart = currentWeekStart()

  const [{ data: challenges }, { data: progress }] = await Promise.all([
    supabase.from('community_challenges').select('id, slug, title, description, goal, coin_reward, xp_reward').eq('active', true),
    supabase.from('player_challenge_progress').select('challenge_id, progress, completed').eq('player_id', viewerId).eq('week_start', weekStart),
  ])
  if (!challenges) return null

  // Fixed display order matching the spec §8 widget mockup — the table has
  // no sort column, so sort here by the seeded slug order instead. A
  // challenge created later via the admin CRUD page (§061) has a slug not
  // in this list — indexOf returns -1, which the `?? SLUG_ORDER.length`
  // fallback pushes to the end rather than (via a raw -1) sorting it first.
  const SLUG_ORDER = ['weekly_grind', 'weekly_winner', 'weekly_post', 'weekly_react']
  const orderOf = (slug: string) => {
    const i = SLUG_ORDER.indexOf(slug)
    return i === -1 ? SLUG_ORDER.length : i
  }
  challenges.sort((a, b) => orderOf(a.slug) - orderOf(b.slug))

  const progressByChallenge = new Map((progress ?? []).map((p) => [p.challenge_id, p]))
  const monday = new Date(`${weekStart}T00:00:00+01:00`)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)

  return {
    weekLabel: `${formatDate(monday.toISOString())} – ${formatDate(sunday.toISOString())}`,
    challenges: challenges.map((c) => {
      const p = progressByChallenge.get(c.id)
      return {
        slug: c.slug,
        title: c.title,
        description: c.description,
        goal: c.goal,
        progress: Math.min(p?.progress ?? 0, c.goal),
        completed: p?.completed ?? false,
        coinReward: c.coin_reward,
        xpReward: c.xp_reward,
      }
    }),
  }
}
