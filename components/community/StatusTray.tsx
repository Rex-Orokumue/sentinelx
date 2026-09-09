'use client'
import { useMemo, useState } from 'react'
import type { StatusRing as StatusRingData } from '@/lib/community/statuses'
import { StatusRing } from './StatusRing'
import { StatusComposer } from './StatusComposer'
import { StatusViewer } from './StatusViewer'

export type TrayViewer = { id: string; name: string; username: string | null; avatarUrl: string | null }

type Overlay = { kind: 'composer' } | { kind: 'viewer'; index: number } | null

export function StatusTray({ rings, viewer }: { rings: StatusRingData[]; viewer: TrayViewer | null }) {
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [seenThisSession, setSeenThisSession] = useState<Set<string>>(new Set())

  const hasOwnRing = rings.some((r) => r.isSelf)

  // Apply this session's optimistic views on top of the server's hasUnseen.
  // Your own ring is never "unseen" — groupIntoRings reports hasUnseen:true for
  // it (you never record views of your own statuses), but WhatsApp-style your
  // ring shows neutral, not a nag.
  const displayRings = useMemo(
    () =>
      rings.map((r) => ({
        ...r,
        displayUnseen:
          !r.isSelf && r.hasUnseen && r.statuses.some((s) => !seenThisSession.has(s.id)),
      })),
    [rings, seenThisSession],
  )

  if (rings.length === 0 && !viewer) return null

  function markSeen(ids: string[]) {
    setSeenThisSession((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })
  }

  return (
    <div className="mb-6">
      <div className="flex gap-3 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {viewer && !hasOwnRing && (
          <StatusRing
            name={viewer.name}
            username={viewer.username}
            avatarUrl={viewer.avatarUrl}
            unseen={false}
            self
            empty
            label="Your status"
            onClick={() => setOverlay({ kind: 'composer' })}
          />
        )}
        {displayRings.map((r, i) => (
          <StatusRing
            key={r.playerId}
            name={r.isSelf ? 'Your status' : r.authorName}
            username={r.authorUsername}
            avatarUrl={r.authorAvatarUrl}
            unseen={r.displayUnseen}
            self={r.isSelf}
            label={r.isSelf ? 'Your status' : undefined}
            onClick={() => setOverlay({ kind: 'viewer', index: i })}
          />
        ))}
        {viewer && hasOwnRing && (
          <StatusRing
            name="Add"
            username={null}
            avatarUrl={viewer.avatarUrl}
            unseen={false}
            self
            empty
            label="Add"
            onClick={() => setOverlay({ kind: 'composer' })}
          />
        )}
      </div>

      {overlay?.kind === 'composer' && <StatusComposer onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'viewer' && (
        <StatusViewer
          rings={rings}
          startIndex={overlay.index}
          viewerId={viewer?.id ?? null}
          onSeen={markSeen}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  )
}
