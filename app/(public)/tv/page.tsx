import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { VideoEmbed } from '@/components/match/VideoEmbed'
import { EmptyState } from '@/components/shared/EmptyState'
import { VideoCard, type CuratedVideo } from '@/components/tv/VideoCard'
import { MatchVideoCard, type MatchVideo } from '@/components/tv/MatchVideoCard'
import { youtubeThumbnail } from '@/lib/tv/thumbnail'
import type { TvCategory } from '@/lib/tv/schema'
import { buildMetadata } from '@/lib/seo/metadata'
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildVideoJsonLd } from '@/lib/seo/schema/video'
import { parseYouTubeId } from '@/lib/matches/youtube'

export const metadata = buildMetadata({
  title: 'Sentinel X TV — Live, Highlights & Replays',
  description: 'Watch live mobile esports, highlights, finals, and match replays on Sentinel X TV.',
  path: '/tv',
  image: DEFAULT_OG_IMAGE,
})

const MATCH_COLS =
  'id, status, round, score_a, score_b, youtube_stream_url, replay_url, completed_at, ' +
  'player_a:profiles!matches_player_a_id_fkey(username, display_name), ' +
  'player_b:profiles!matches_player_b_id_fkey(username, display_name), ' +
  'tournament:tournaments(title)'

type NameRef =
  | { username: string | null; display_name: string | null }
  | { username: string | null; display_name: string | null }[]
  | null
function nameOf(x: NameRef): string {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.display_name ?? r?.username ?? 'TBD'
}
type TitleRef = { title: string } | { title: string }[] | null
function titleOf(x: TitleRef): string | null {
  const r = Array.isArray(x) ? x[0] ?? null : x
  return r?.title ?? null
}

type MatchRow = {
  id: string
  status: string
  round: string
  score_a: number | null
  score_b: number | null
  youtube_stream_url: string | null
  replay_url: string | null
  completed_at: string | null
  player_a: NameRef
  player_b: NameRef
  tournament: TitleRef
}

function toMatchVideo(m: MatchRow, live: boolean): MatchVideo {
  const a = nameOf(m.player_a)
  const b = nameOf(m.player_b)
  const scored = m.score_a != null && m.score_b != null
  const t = titleOf(m.tournament)
  const subtitle = scored ? `${t ? `${t} · ` : ''}${m.score_a}–${m.score_b}` : t
  return {
    id: m.id,
    title: `${a} vs ${b}`,
    subtitle,
    thumbnailUrl: youtubeThumbnail(live ? m.youtube_stream_url : m.replay_url),
    isLive: live,
  }
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-8 text-base font-bold text-white">{children}</h2>
}

export default async function TvPage() {
  const supabase = createClient()
  const [{ data: liveRaw }, { data: curatedRaw }, { data: finalsRaw }, { data: replaysRaw }] =
    await Promise.all([
      supabase
        .from('matches')
        .select(MATCH_COLS)
        .eq('status', 'live')
        .not('youtube_stream_url', 'is', null)
        .order('updated_at', { ascending: false }),
      supabase
        .from('tv_videos')
        .select('id, title, youtube_url, category, thumbnail_url, published_at')
        .eq('active', true)
        .order('published_at', { ascending: false }),
      supabase
        .from('matches')
        .select(MATCH_COLS)
        .eq('round', 'final')
        .eq('status', 'completed')
        .not('replay_url', 'is', null)
        .order('completed_at', { ascending: false }),
      supabase
        .from('matches')
        .select(MATCH_COLS)
        .eq('status', 'completed')
        .not('replay_url', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(12),
    ])

  const live = (liveRaw ?? []) as unknown as MatchRow[]
  const finals = (finalsRaw ?? []) as unknown as MatchRow[]
  const replays = (replaysRaw ?? []) as unknown as MatchRow[]
  const curated: CuratedVideo[] = (curatedRaw ?? []).map((v) => ({
    id: v.id,
    title: v.title,
    category: v.category as TvCategory,
    youtubeUrl: v.youtube_url,
    thumbnailUrl: v.thumbnail_url,
    publishedAt: v.published_at,
  }))

  const hero = live[0] ?? null
  const isEmpty =
    live.length === 0 && curated.length === 0 && finals.length === 0 && replays.length === 0

  const videoJsonLdEntries = [
    ...curated.map((v) => {
      const id = parseYouTubeId(v.youtubeUrl)
      if (!id) return null
      return buildVideoJsonLd({
        name: v.title,
        description: null,
        thumbnailUrl: v.thumbnailUrl ?? youtubeThumbnail(v.youtubeUrl),
        embedUrl: `https://www.youtube.com/embed/${id}`,
        uploadDate: v.publishedAt,
      })
    }),
    ...finals.map((m) => {
      const id = parseYouTubeId(m.replay_url)
      if (!id || !m.completed_at) return null
      return buildVideoJsonLd({
        name: `${nameOf(m.player_a)} vs ${nameOf(m.player_b)}`,
        description: `Final — ${titleOf(m.tournament) ?? 'Sentinel X'}.`,
        thumbnailUrl: youtubeThumbnail(m.replay_url),
        embedUrl: `https://www.youtube.com/embed/${id}`,
        uploadDate: m.completed_at,
      })
    }),
  ].filter((v): v is NonNullable<typeof v> => v !== null)

  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      {videoJsonLdEntries.map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Sentinel X TV</h1>
        <p className="mt-1 text-sm text-slate-400">Live matches, highlights, finals, and replays.</p>
      </div>

      {isEmpty && (
        <EmptyState icon="📺" title="Nothing on air yet" body="Live matches and replays will show up here." />
      )}

      {hero && (
        <section>
          <SectionTitle>🔴 Live Now</SectionTitle>
          <VideoEmbed streamUrl={hero.youtube_stream_url} replayUrl={null} isLive />
          <Link
            href={`/matches/${hero.id}`}
            className="mt-2 inline-block text-sm font-semibold text-violet-400 hover:text-violet-300"
          >
            {nameOf(hero.player_a)} vs {nameOf(hero.player_b)} — open Match Centre →
          </Link>
          {live.length > 1 && (
            <div className="mt-4">
              <Grid>
                {live.slice(1).map((m) => (
                  <MatchVideoCard key={m.id} video={toMatchVideo(m, true)} />
                ))}
              </Grid>
            </div>
          )}
        </section>
      )}

      {curated.length > 0 && (
        <section>
          <SectionTitle>Highlights</SectionTitle>
          <Grid>
            {curated.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </Grid>
        </section>
      )}

      {finals.length > 0 && (
        <section>
          <SectionTitle>Finals</SectionTitle>
          <Grid>
            {finals.map((m) => (
              <MatchVideoCard key={m.id} video={toMatchVideo(m, false)} />
            ))}
          </Grid>
        </section>
      )}

      {replays.length > 0 && (
        <section>
          <SectionTitle>All Replays</SectionTitle>
          <Grid>
            {replays.map((m) => (
              <MatchVideoCard key={m.id} video={toMatchVideo(m, false)} />
            ))}
          </Grid>
        </section>
      )}
    </div>
  )
}
