import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/admin/auth'
import {
  ReleaseUsernameForm,
  ClearIdentifierForm,
} from '@/components/admin/AccountRecoveryForms'

export const metadata: Metadata = { title: 'Account recovery · Admin · SentinelX' }

type ActorRef = { username: string | null; display_name: string | null } | null
function nameOf(p: ActorRef | ActorRef[]): string {
  const r = Array.isArray(p) ? p[0] ?? null : p
  return r?.display_name ?? r?.username ?? 'Admin'
}

const ACTION_LABEL: Record<string, string> = {
  release_username: 'Released username',
  clear_identifier: 'Cleared identifier',
}

export default async function AdminAccountRecoveryPage() {
  await requireAdmin()
  const admin = createAdminClient()

  const [{ data: log }, { count: retiredCount }, { count: bannedCount }] = await Promise.all([
    admin
      .from('admin_recovery_log')
      .select('id, action, target, created_at, profiles!admin_recovery_log_actor_id_fkey(username, display_name)')
      .order('created_at', { ascending: false })
      .limit(50),
    admin.from('retired_usernames').select('username', { count: 'exact', head: true }),
    admin.from('banned_identifiers').select('hash', { count: 'exact', head: true }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-black text-white">Account recovery</h1>
        <p className="mt-1 text-sm text-sx-gray">
          Reverses the two permanent decisions account deletion makes. Both are irreversible from
          the player&apos;s side, so both need a way back.
        </p>
        <p className="mt-2 text-xs text-sx-gray">
          {retiredCount ?? 0} retired username{retiredCount === 1 ? '' : 's'} ·{' '}
          {bannedCount ?? 0} banned identifier{bannedCount === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReleaseUsernameForm />
        <ClearIdentifierForm />
      </div>

      <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white">Recent actions</h2>
        {(log ?? []).length === 0 ? (
          <p className="mt-3 text-xs text-sx-gray">Nothing has been released or cleared yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-xs">
              <thead className="text-sx-gray">
                <tr>
                  <th className="py-2 pr-4 font-semibold">When</th>
                  <th className="py-2 pr-4 font-semibold">Admin</th>
                  <th className="py-2 pr-4 font-semibold">Action</th>
                  <th className="py-2 font-semibold">Target</th>
                </tr>
              </thead>
              <tbody className="text-white/80">
                {(log ?? []).map((row) => (
                  <tr key={row.id} className="border-t border-sx-border">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">{nameOf(row.profiles as ActorRef | ActorRef[])}</td>
                    <td className="py-2 pr-4">{ACTION_LABEL[row.action] ?? row.action}</td>
                    {/* A cleared identifier logs its hash, never the address —
                        logging the plaintext would reintroduce the personal
                        data deletion removed. Truncated for width. */}
                    <td className="py-2 font-mono text-[11px]">
                      {row.action === 'clear_identifier' ? `${row.target.slice(0, 16)}…` : row.target}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
