'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { removePayoutAccount } from '@/lib/kyc/actions'

export function RemoveAccountButton() {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await removePayoutAccount()
          router.refresh()
        })
      }
      className="text-xs font-bold text-red-400 hover:text-red-300 disabled:opacity-50"
    >
      {pending ? 'Removing…' : 'Remove'}
    </button>
  )
}
