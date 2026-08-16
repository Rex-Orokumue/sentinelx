import Link from 'next/link'
import { formatRelativeTime } from '@/lib/format'

export interface ProfilePost {
  id: string
  content: string
  postType: string
  createdAt: string
}

const TYPE_ICON: Record<string, string> = {
  manual: '💬',
  match_result: '⚽',
  achievement: '🏅',
  announcement: '📣',
}

export function ProfileCommunityPosts({ posts, username }: { posts: ProfilePost[]; username: string }) {
  return (
    <section id="posts" className="scroll-mt-24">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-widest text-white">Community Posts</h2>
        <Link href={`/community?author=${username}`} className="text-xs font-semibold text-sx-purple-text hover:text-sx-purple-light">
          View all on Community →
        </Link>
      </div>
      {posts.length === 0 ? (
        <p className="text-sm text-sx-gray">No community posts yet.</p>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <div key={p.id} className="rounded-xl border border-sx-border bg-sx-surface p-4">
              <div className="flex items-center gap-2 text-xs text-sx-gray">
                <span>{TYPE_ICON[p.postType] ?? '💬'}</span>
                <span>{formatRelativeTime(p.createdAt)}</span>
              </div>
              <p className="mt-1.5 line-clamp-3 text-sm text-white">{p.content}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
