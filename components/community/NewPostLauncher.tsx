'use client'
import { useState } from 'react'
import Link from 'next/link'
import { PostComposer, type ViewerProfile } from './PostComposer'

// Guests see a login link instead of the composer trigger (spec §4 — posting
// requires auth; reading the feed doesn't).
export function NewPostLauncher({ viewer }: { viewer: ViewerProfile | null }) {
  const [open, setOpen] = useState(false)

  if (!viewer) {
    return (
      <Link
        href="/login?next=/community"
        className="rounded-lg border border-sx-border px-4 py-2 text-xs font-bold text-sx-gray hover:border-sx-purple/40 hover:text-sx-white"
      >
        Log in to post
      </Link>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white hover:bg-sx-purple-light"
      >
        + New Post
      </button>
      {open && <PostComposer viewer={viewer} onClose={() => setOpen(false)} />}
    </>
  )
}
