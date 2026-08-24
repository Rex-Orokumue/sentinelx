import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ChallengeForm } from '@/components/admin/ChallengeForm'

export const metadata: Metadata = { title: 'Weekly Challenges · Admin · SentinelX' }

export default async function AdminChallengesPage() {
  await requireAdmin()
  const admin = createAdminClient()
  const { data: challenges } = await admin
    .from('community_challenges')
    .select('id, slug, title, description, challenge_type, goal, coin_reward, xp_reward, active')
    .order('slug')

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-black text-white">Weekly Challenges</h1>
      <ChallengeForm mode="create" />
      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm text-slate-300">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Challenge</th>
              <th>Title / Description / Goal / Rewards</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {(challenges ?? []).map((item) => (
              <ChallengeForm key={item.id} mode="edit" item={item} />
            ))}
          </tbody>
        </table>
        {(challenges ?? []).length === 0 && (
          <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
            No challenges yet.
          </p>
        )}
      </div>
    </div>
  )
}
