import { postShareUrl } from '@/lib/community/whatsapp'
import type { PostView } from '@/lib/community/feed-query'

// Spec §12 — plain wa.me/?text= link, no API, no client interactivity needed.
export function ShareButton({ post }: { post: PostView }) {
  return (
    <a
      href={postShareUrl(post)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-semibold text-sx-gray hover:text-sx-white"
      aria-label="Share on WhatsApp"
    >
      ↗ Share
    </a>
  )
}
