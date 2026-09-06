'use client'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { cancelAccountDeletion } from '@/lib/settings/account'
import { deletionDueAt, daysRemaining } from '@/lib/settings/grace'

// Deliberately not dismissible. Dismissing the only standing warning about
// impending account deletion defeats the point of showing it — and the whole
// value of the grace period is that the user notices in time to cancel.
export function PendingDeletionBanner({ requestedAt }: { requestedAt: string }) {
  const t = useTranslations('accountDeletion')
  const router = useRouter()
  const requested = new Date(requestedAt)
  const due = deletionDueAt(requested)
  const left = daysRemaining(requested, new Date())

  return (
    <div className="border-b border-red-900/50 bg-red-950/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2.5 text-xs text-red-200 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t('bannerText', { date: due.toDateString(), days: left })}</span>
        </p>
        <form
          action={async () => {
            await cancelAccountDeletion()
            router.refresh()
          }}
        >
          <button
            type="submit"
            className="whitespace-nowrap rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
          >
            {t('bannerCancel')}
          </button>
        </form>
      </div>
    </div>
  )
}
