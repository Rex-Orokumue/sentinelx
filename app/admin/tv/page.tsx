import type { Metadata } from 'next'
import { requireStaff } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'
import { TvVideoForm } from '@/components/admin/TvVideoForm'
import { TvVideoRow, type AdminTvVideo } from '@/components/admin/TvVideoRow'
import type { TvCategory } from '@/lib/tv/schema'
import { EmptyState } from '@/components/shared/EmptyState'

export const metadata: Metadata = { title: 'TV · Admin · SentinelX' }

export default async function AdminTvPage() {
  await requireStaff()
  const supabase = createClient()
  const { data } = await supabase
    .from('tv_videos')
    .select('id, title, category, youtube_url, description, active')
    .order('published_at', { ascending: false })

  const videos: AdminTvVideo[] = (data ?? []).map((v) => ({
    id: v.id,
    title: v.title,
    category: v.category as TvCategory,
    youtubeUrl: v.youtube_url,
    description: v.description,
    active: v.active,
  }))

  return (
    <div>
      <h1 className="mb-4 text-xl font-black text-white">Sentinel X TV</h1>
      <div className="mb-8">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">Add a video</h2>
        <TvVideoForm />
      </div>
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500">Videos</h2>
      {videos.length === 0 ? (
        <EmptyState icon="📺" title="No videos yet" body="Add a YouTube clip above to feature it on TV." />
      ) : (
        <div className="space-y-2">
          {videos.map((v) => (
            <TvVideoRow key={v.id} video={v} />
          ))}
        </div>
      )}
    </div>
  )
}
