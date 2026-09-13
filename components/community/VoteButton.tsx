'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { castBestPlayVote, type VoteState } from '@/lib/community/best-play-actions'

function VoteSubmitButton({ disabled, voteCount }: { disabled: boolean; voteCount: number }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-full border border-amber-500/40 px-3 py-1 text-xs font-bold text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
    >
      {pending ? 'Voting…' : `Vote 🔥 · ${voteCount}`}
    </button>
  )
}

export function VoteButton({
  nominationId,
  voteCount,
  hasVoted,
  disabled,
}: {
  nominationId: string
  voteCount: number
  hasVoted: boolean
  disabled: boolean
}) {
  const router = useRouter()
  const [state, action] = useFormState<VoteState, FormData>(castBestPlayVote, undefined)

  useEffect(() => {
    if (state && !state.error) router.refresh()
  }, [state, router])

  if (hasVoted) {
    return <span className="shrink-0 text-xs font-bold text-amber-400">✓ Voted · {voteCount}</span>
  }

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="nominationId" value={nominationId} />
      <VoteSubmitButton disabled={disabled} voteCount={voteCount} />
      {state?.error && <p className="mt-1 text-[10px] text-red-400">{state.error}</p>}
    </form>
  )
}
