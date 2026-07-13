'use client'
import { useEffect, useRef } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createReply, type ReplyState } from '@/lib/community/actions'

export function ReplyComposer({ postId }: { postId: string }) {
  const [state, formAction] = useFormState<ReplyState, FormData>(createReply, undefined)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.success) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={formAction} className="mt-3 flex gap-2">
      <input type="hidden" name="postId" value={postId} />
      <textarea
        name="body"
        rows={1}
        required
        maxLength={2000}
        placeholder="Write a reply…"
        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <SubmitButton />
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? '…' : 'Reply'}
    </button>
  )
}
