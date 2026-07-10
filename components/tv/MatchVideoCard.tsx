import Link from 'next/link'
import { Play } from 'lucide-react'

export interface MatchVideo {
  id: string
  title: string
  subtitle: string | null
  thumbnailUrl: string | null
  isLive?: boolean
}

export function MatchVideoCard({ video }: { video: MatchVideo }) {
  return (
    <Link href={`/matches/${video.id}`} className="group block">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {video.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-10 w-10 text-white" />
        </span>
        {video.isLive && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            LIVE
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-sm font-semibold text-white">{video.title}</p>
      {video.subtitle && <p className="truncate text-xs text-slate-500">{video.subtitle}</p>}
    </Link>
  )
}
