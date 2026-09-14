import { Share2 } from 'lucide-react'
import { postShareUrl } from '@/lib/community/whatsapp'
import type { PostView } from '@/lib/community/feed-query'

// Spec §12 — plain wa.me/?text= link, no API, no client interactivity needed.
export function ShareButton({ post }: { post: PostView }) {
  return (
    <a
      href={postShareUrl(post)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 text-xs font-semibold text-sx-gray hover:text-white"
      aria-label="Share on WhatsApp"
    >
      <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Share
    </a>
  )
}
