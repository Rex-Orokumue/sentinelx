'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ImagePlus } from 'lucide-react'
import { HexAvatar } from '@/components/shared/HexAvatar'
import type { MembershipTier } from '@/lib/membership/tiers'
import { PostComposer, type ViewerProfile } from './PostComposer'

// Inline composer trigger at the top of the feed — the universal "what's on your
// mind" box, not a button tucked next to a heading. Guests get the same box
// pointing at login (spec §4 — posting requires auth; reading doesn't).
export function NewPostLauncher({ viewer }: { viewer: ViewerProfile | null }) {
  const [open, setOpen] = useState(false)

  if (!viewer) {
    return (
      <Link
        href="/login?next=/community"
        className="flex w-full items-center gap-3 rounded-xl border border-sx-border bg-sx-surface px-4 py-3 text-sm text-sx-gray transition-colors hover:border-sx-purple/40 hover:text-sx-white"
      >
        Log in to share something with the community
      </Link>
    )
  }

  const name = viewer.displayName ?? viewer.username ?? 'You'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-sx-border bg-sx-surface px-3 py-3 text-left transition-colors hover:border-sx-purple/40"
      >
        <HexAvatar src={viewer.avatarUrl} username={name} tier={viewer.membershipTier as MembershipTier} size="sm" />
        <span className="flex-1 truncate text-sm text-sx-gray">Share something with the community…</span>
        <ImagePlus className="h-5 w-5 shrink-0 text-sx-gray" />
      </button>
      {open && <PostComposer viewer={viewer} onClose={() => setOpen(false)} />}
    </>
  )
}
