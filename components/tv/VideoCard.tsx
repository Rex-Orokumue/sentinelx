'use client'
import { useState } from 'react'
import { Play } from 'lucide-react'
import { parseYouTubeId } from '@/lib/matches/youtube'
import { youtubeThumbnail } from '@/lib/tv/thumbnail'
import { CATEGORY_LABELS, type TvCategory } from '@/lib/tv/schema'
import { VideoModal } from '@/components/tv/VideoModal'

export interface CuratedVideo {
  id: string
  title: string
  category: TvCategory
  youtubeUrl: string
  thumbnailUrl: string | null
}

export function VideoCard({ video }: { video: CuratedVideo }) {
  const [open, setOpen] = useState(false)
  const ytId = parseYouTubeId(video.youtubeUrl)
  if (!ytId) return null
  const thumb = video.thumbnailUrl ?? youtubeThumbnail(video.youtubeUrl)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group block w-full text-left">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {thumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
            <Play className="h-10 w-10 text-white" />
          </span>
          <span className="absolute left-2 top-2 rounded-full bg-violet-600/90 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
            {CATEGORY_LABELS[video.category]}
          </span>
        </div>
        <p className="mt-1.5 truncate text-sm font-semibold text-white">{video.title}</p>
      </button>
      {open && <VideoModal videoId={ytId} title={video.title} onClose={() => setOpen(false)} />}
    </>
  )
}
