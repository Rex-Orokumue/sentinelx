'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Smile } from 'lucide-react'
import { toggleReaction } from '@/lib/community/reaction-actions'
import { REACTIONS, type ReactionType } from '@/lib/community/schema'

const EMOJI: Record<ReactionType, string> = { fire: '🔥', crown: '👑', strong: '💪', wow: '😮' }
const LABEL: Record<ReactionType, string> = { fire: 'Fire', crown: 'Crown', strong: 'Strong', wow: 'Wow' }

// Spec §5.1 — one reaction per player per post; tapping the same one removes
// it, tapping a different one replaces it. Guests get bounced to login
// (spec §4) rather than a silent failed request.
//
// Facebook-style single trigger: the four reactions used to sit spread out
// inline (cluttered, and grew unreadable once counts got large). Now the
// trigger shows just my own reaction (or a neutral "React" + total count),
// and tapping it opens a flyout with all four to pick from — same ref +
// outside-click + Escape pattern as NavMoreDropdown/AccountMenu, so this is
// the third dropdown built on that shared idiom, not a new one.
export function ReactionBar({
  postId,
  counts,
  myReaction,
  loggedIn,
}: {
  postId: string
  counts: Record<ReactionType, number>
  myReaction: ReactionType | null
  loggedIn: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [local, setLocal] = useState({ counts, mine: myReaction })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const total = REACTIONS.reduce((sum, r) => sum + local.counts[r], 0)

  function onTriggerClick() {
    if (!loggedIn) {
      router.push('/login?next=/community')
      return
    }
    setOpen((o) => !o)
  }

  function onPick(reaction: ReactionType) {
    setOpen(false)
    if (pending) return

    const prev = local
    const nextCounts = { ...prev.counts }
    if (prev.mine) nextCounts[prev.mine] = Math.max(0, nextCounts[prev.mine] - 1)
    const removing = prev.mine === reaction
    if (!removing) nextCounts[reaction] = nextCounts[reaction] + 1
    setLocal({ counts: nextCounts, mine: removing ? null : reaction })

    startTransition(async () => {
      const res = await toggleReaction(postId, reaction)
      if (res?.error) {
        setLocal(prev) // roll back on failure
        router.refresh()
      }
    })
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onTriggerClick}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="React to this post"
        className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold transition-colors ${
          local.mine ? 'bg-sx-purple/20 text-sx-purple-text' : 'text-sx-gray hover:text-sx-white'
        }`}
      >
        {local.mine ? <span aria-hidden>{EMOJI[local.mine]}</span> : <Smile className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        <span>{local.mine ? LABEL[local.mine] : 'React'}</span>
        {total > 0 && <span className="text-sx-gray">{total}</span>}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-1.5 flex items-center gap-0.5 rounded-full border border-sx-border bg-sx-surface p-1 shadow-lg"
        >
          {REACTIONS.map((r) => (
            <button
              key={r}
              type="button"
              role="menuitemradio"
              aria-checked={local.mine === r}
              onClick={() => onPick(r)}
              aria-label={`${LABEL[r]} (${local.counts[r]})`}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 ${
                local.mine === r ? 'bg-sx-purple/20' : ''
              }`}
            >
              <span aria-hidden>{EMOJI[r]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
