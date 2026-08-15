import { formatRelativeTime } from '@/lib/format'
import type { PostView } from '@/lib/community/feed-query'

// Spec §5.4 — purple left border, broadcast-only (no reactions/comments).
// An optional "Register Now →" style CTA link is admin-authored as part of
// the content itself (a plain URL on its own line, linkified below) rather
// than a separate structured field — keeps the schema to one content column
// like every other post type.
const URL_SPLIT_RE = /(https?:\/\/\S+)/g
const URL_TEST_RE = /^https?:\/\/\S+$/

function linkify(content: string) {
  return content.split('\n').map((line, i) => {
    const parts = line.split(URL_SPLIT_RE)
    return (
      <p key={i} className={i > 0 ? 'mt-1' : ''}>
        {parts.map((part, j) =>
          URL_TEST_RE.test(part) ? (
            <a key={j} href={part} className="font-bold text-sx-purple-text hover:text-sx-purple-light">
              {part} →
            </a>
          ) : (
            <span key={j}>{part}</span>
          ),
        )}
      </p>
    )
  })
}

export function AnnouncementCard({ post }: { post: PostView }) {
  return (
    <div className="rounded-2xl border-l-4 border-l-sx-purple border-y border-r border-sx-border bg-sx-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-widest text-sx-purple-text">📌 Announcement</p>
        <p className="text-xs text-sx-gray">{formatRelativeTime(post.createdAt)}</p>
      </div>
      <div className="mt-2 whitespace-pre-line text-sm text-sx-white">{linkify(post.content)}</div>
      {post.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.imageUrl} alt="" className="mt-3 max-h-72 w-full rounded-lg object-cover" />
      )}
    </div>
  )
}
