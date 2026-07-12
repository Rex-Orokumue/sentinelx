import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/admin/auth'
import { RegistrationsTable, type AdminRegistrationRow } from '@/components/admin/RegistrationsTable'

export const metadata: Metadata = { title: 'Registrations · Admin · SentinelX' }

type ProfileRef = { username: string | null } | { username: string | null }[] | null
function firstUsername(p: ProfileRef): string | null {
  return Array.isArray(p) ? p[0]?.username ?? null : p?.username ?? null
}

export default async function AdminRegistrationsPage({ params }: { params: { id: string } }) {
  await requireStaff()
  const supabase = createClient()
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, title')
    .eq('id', params.id)
    .maybeSingle()
  if (!t) notFound()

  const { data } = await supabase
    .from('tournament_registrations')
    .select(
      'id, payment_status, registered_at, reg_display_name, reg_whatsapp, reg_club_name, reg_ign_tag, profiles(username)',
    )
    .eq('tournament_id', t.id)
    .order('registered_at', { ascending: false })

  const rows: AdminRegistrationRow[] = ((data as unknown[] | null) ?? []).map((raw) => {
    const r = raw as {
      id: string
      payment_status: string
      registered_at: string
      reg_display_name: string | null
      reg_whatsapp: string | null
      reg_club_name: string | null
      reg_ign_tag: string | null
      profiles: ProfileRef
    }
    return {
      id: r.id,
      username: firstUsername(r.profiles),
      regDisplayName: r.reg_display_name,
      regWhatsapp: r.reg_whatsapp,
      regClubName: r.reg_club_name,
      regIgnTag: r.reg_ign_tag,
      paymentStatus: r.payment_status,
      registeredAt: r.registered_at,
    }
  })

  return (
    <section>
      <Link href="/admin/tournaments" className="text-sm text-violet-400 hover:text-violet-300">
        ← Tournaments
      </Link>
      <h2 className="mb-4 mt-2 text-base font-bold text-white">{t.title} · Registrations</h2>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-500">
          No registrations yet.
        </p>
      ) : (
        <RegistrationsTable rows={rows} />
      )}
    </section>
  )
}
