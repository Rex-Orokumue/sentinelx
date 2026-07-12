import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveRegistrationView } from '@/lib/tournaments/view'
import { RegistrationPanel } from '@/components/tournament/RegistrationPanel'
import { formatDate, formatNaira } from '@/lib/format'
import ReactMarkdown from 'react-markdown'
import { RegistrationCountdown } from '@/components/tournament/RegistrationCountdown'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sentinelx.gg'

const STATUS: Record<string, { label: string; cls: string }> = {
  active:              { label: 'LIVE',        cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  registration_open:   { label: 'OPEN',        cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  registration_closed: { label: 'REG. CLOSED', cls: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
  completed:           { label: 'ENDED',       cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
}

async function getTournament(slug: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('tournaments')
    .select(
      'id, title, slug, description, banner_url, prize_pool, registration_fee, status, format, max_players, registration_end, tournament_start, rules, games(name, icon_url, slug)',
    )
    .eq('slug', slug)
    .maybeSingle()
  return data
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const t = await getTournament(params.slug)
  if (!t || t.status === 'draft') return { title: 'Tournament — Sentinel X' }
  const title = `${t.title} — Sentinel X`
  const description =
    t.description?.slice(0, 160) ??
    `${formatNaira(t.prize_pool)} prize pool. Entry ${formatNaira(t.registration_fee)}. Compete on Sentinel X.`
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/tournaments/${t.slug}`,
      siteName: 'Sentinel X',
      type: 'website',
      images: t.banner_url ? [t.banner_url] : undefined,
    },
  }
}

export default async function TournamentDetailPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { paid?: string; payment?: string }
}) {
  const supabase = createClient()
  const t = await getTournament(params.slug)
  if (!t || t.status === 'draft') notFound()

  const [{ count: paidCount }, { data: { user } }] = await Promise.all([
    supabase
      .from('tournament_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', t.id)
      .eq('payment_status', 'paid'),
    supabase.auth.getUser(),
  ])

  let existingStatus: string | null = null
  let prefill = { displayName: '', whatsapp: '' }
  if (user) {
    const [{ data: reg }, { data: profile }] = await Promise.all([
      supabase
        .from('tournament_registrations')
        .select('payment_status')
        .eq('tournament_id', t.id)
        .eq('player_id', user.id)
        .maybeSingle(),
      supabase.from('profiles').select('display_name, whatsapp_number').eq('id', user.id).maybeSingle(),
    ])
    existingStatus = reg?.payment_status ?? null
    prefill = { displayName: profile?.display_name ?? '', whatsapp: profile?.whatsapp_number ?? '' }
  }

  const view = resolveRegistrationView({
    status: t.status,
    loggedIn: !!user,
    paidCount: paidCount ?? 0,
    maxPlayers: t.max_players,
    existingStatus,
  })

  const status = STATUS[t.status] ?? STATUS.completed
  const start = formatDate(t.tournament_start)
  const game = t.games as { name: string; icon_url: string | null; slug: string } | null
  const shareText = `${t.title} on Sentinel X — ${formatNaira(t.prize_pool)} prize pool 🎮 ${SITE_URL}/tournaments/${t.slug}`

  return (
    <div className="mx-auto max-w-3xl px-4 pb-20">
      <Link
        href="/tournaments"
        className="mt-6 mb-4 inline-block text-sm text-violet-400 hover:text-violet-300"
      >
        ← All tournaments
      </Link>

      {searchParams.paid === '1' && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-400">
          🎉 Payment confirmed — you&apos;re registered!
        </div>
      )}
      {searchParams.payment === 'failed' && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400">
          Payment was not completed. You can try again below.
        </div>
      )}

      {t.banner_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={t.banner_url}
          alt={t.title}
          className="mb-5 aspect-video w-full rounded-2xl border border-slate-800 object-cover"
        />
      )}

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {game?.name ?? 'Mobile Esports'}
          </p>
          <h1 className="text-2xl font-black leading-tight text-white">{t.title}</h1>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>
          {status.label}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:grid-cols-4">
        <Stat label="Prize Pool" value={formatNaira(t.prize_pool)} accent />
        <Stat label="Entry Fee" value={formatNaira(t.registration_fee)} />
        <Stat
          label="Players"
          value={t.max_players != null ? `${paidCount ?? 0}/${t.max_players}` : `${paidCount ?? 0}`}
        />
        <Stat label="Format" value={t.format === 'group_knockout' ? 'Groups + KO' : t.format} />
      </div>

      {t.rules && (
        <div className="mb-6 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5 text-sm leading-relaxed text-slate-300 [&_a]:text-violet-400 [&_a]:underline [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:text-white [&_ul]:list-disc [&_ul]:pl-5">
          <h2 className="mb-2 text-base font-bold text-white">Tournament Rules</h2>
          <ReactMarkdown>{t.rules}</ReactMarkdown>
        </div>
      )}

      <div className="mb-6">
        {(t.status === 'registration_open' || t.status === 'registration_closed') && (
          <RegistrationCountdown registrationEnd={t.registration_end} />
        )}
        <RegistrationPanel
          view={view}
          tournamentId={t.id}
          slug={t.slug}
          fee={t.registration_fee}
          loginHref={`/login?next=/tournaments/${t.slug}`}
          prefill={prefill}
          hasRules={!!t.rules}
        />
      </div>

      {start && (
        <div className="mb-6 flex flex-wrap gap-x-8 gap-y-2 text-sm text-slate-400">
          <span>🗓️ Starts {start}</span>
        </div>
      )}

      {t.description && (
        <div className="mb-8">
          <h2 className="mb-2 text-base font-bold text-white">About</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{t.description}</p>
        </div>
      )}

      <a
        href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-xl border border-[#25D366]/30 px-6 py-3 text-sm font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
      >
        Share on WhatsApp
      </a>
    </div>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`font-black ${accent ? 'text-lg text-violet-400' : 'text-lg text-white'}`}>{value}</p>
    </div>
  )
}
