'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { acceptMessageRequest, declineMessageRequest, blockUser, reportConversation } from '@/lib/messages/actions'

// Shown instead of the composer on an incoming message request. The thread is preview-only until the player
// answers: opening it stamps no read receipt (the server skips receipts on a pending request).
export function RequestBanner({ threadId, otherId, otherName }: { threadId: string; otherId: string; otherName: string }) {
  const t = useTranslations('dmRequests')
  const router = useRouter()
  const [pending, start] = useTransition()
  const [failed, setFailed] = useState(false)

  function run(action: () => Promise<{ error?: string }>, after: () => void) {
    setFailed(false)
    start(async () => {
      const res = await action()
      if (res.error) {
        setFailed(true)
        return
      }
      after()
    })
  }

  const leave = () => router.push('/messages')

  return (
    <div className="sticky bottom-0 z-10 border-t border-sx-border bg-sx-surface px-4 py-3">
      <p className="text-sm font-bold text-white">{t('incomingTitle', { name: otherName })}</p>
      <p className="mt-1 text-xs text-sx-gray">{t('incomingHint')}</p>
      {failed && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {t('actionFailed')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => acceptMessageRequest(threadId), () => router.refresh())}
          className="rounded-lg bg-sx-purple px-4 py-2 text-sm font-bold text-white hover:bg-sx-purple-light disabled:opacity-50"
        >
          {t('accept')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => declineMessageRequest(threadId), leave)}
          className="rounded-lg border border-sx-border px-4 py-2 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50"
        >
          {t('decline')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const blocked = await blockUser(otherId)
              if (blocked.error) return blocked
              return reportConversation({ threadId, reason: 'Unwanted message request' })
            }, leave)
          }
          className="rounded-lg px-4 py-2 text-sm font-semibold text-red-400 hover:bg-white/5 disabled:opacity-50"
        >
          {t('blockAndReport')}
        </button>
      </div>
    </div>
  )
}
