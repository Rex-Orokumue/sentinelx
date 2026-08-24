import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PlayerEconomyPanel } from '@/components/admin/PlayerEconomyPanel'

export const metadata: Metadata = { title: 'Player · Admin · SentinelX' }

export default async function AdminPlayerDetailPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const admin = createAdminClient()

  const [{ data: profile }, { data: coins }, { data: unlockedAchievements }, { data: allAchievements }] =
    await Promise.all([
      admin
        .from('profiles')
        .select('id, username, display_name, xp, membership_tier, sx_score')
        .eq('id', params.id)
        .maybeSingle(),
      admin.from('sx_coins').select('balance, total_earned, total_spent').eq('player_id', params.id).maybeSingle(),
      admin.from('player_achievements').select('achievement_id, unlocked_at, achievements(name)').eq('player_id', params.id),
      admin.from('achievements').select('id, name, category').order('sort_order'),
    ])
  if (!profile) notFound()

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-black text-white">{profile.display_name ?? profile.username}</h1>
      <p className="mb-6 text-sm text-slate-400">
        @{profile.username} · SX Score {profile.sx_score} · {profile.xp} XP · {profile.membership_tier}
      </p>
      <PlayerEconomyPanel
        playerId={profile.id}
        coinBalance={coins?.balance ?? 0}
        totalEarned={coins?.total_earned ?? 0}
        totalSpent={coins?.total_spent ?? 0}
        xp={profile.xp}
        membershipTier={profile.membership_tier}
        unlockedAchievements={(unlockedAchievements ?? []).map((r) => ({
          achievementId: r.achievement_id,
          unlockedAt: r.unlocked_at,
        }))}
        allAchievements={allAchievements ?? []}
      />
    </div>
  )
}
