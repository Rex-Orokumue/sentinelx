import { parseYouTubeId, youtubeEmbedUrl } from '@/lib/matches/youtube'

export function VideoEmbed({
  streamUrl,
  replayUrl,
  isLive,
}: {
  streamUrl: string | null
  replayUrl: string | null
  isLive: boolean
}) {
  const src = isLive ? streamUrl : replayUrl ?? streamUrl
  const id = parseYouTubeId(src)

  if (!id) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-sm text-slate-500">
        No stream or replay yet
      </div>
    )
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-800">
      {isLive && (
        <span className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[11px] font-bold text-white">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          LIVE
        </span>
      )}
      <iframe
        src={youtubeEmbedUrl(id)}
        title="Match video"
        className="absolute inset-0 h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  )
}
