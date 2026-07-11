'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { initiateEscrowPurchase } from '@/lib/exchange/purchase'

type ViewerState = 'guest' | 'owner' | 'buyable'

export function BuyButton({
  listingId,
  viewerState,
}: {
  listingId: string
  viewerState: ViewerState
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (viewerState === 'owner') {
    return <p className="text-center text-xs text-slate-500">This is your listing.</p>
  }

  if (viewerState === 'guest') {
    return (
      <Link
        href={`/login?next=/exchange/${listingId}`}
        className="block w-full rounded-xl bg-violet-600 px-5 py-3 text-center text-sm font-bold text-white hover:bg-violet-500"
      >
        Log in to buy
      </Link>
    )
  }

  function onBuy() {
    setError(null)
    startTransition(async () => {
      const res = await initiateEscrowPurchase(listingId)
      if (res.paymentLink) {
        window.location.href = res.paymentLink
      } else {
        setError(res.error ?? 'Something went wrong.')
      }
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBuy}
        disabled={pending}
        className="w-full rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Starting secure checkout…' : '🔒 Buy — Protected by Zolarux'}
      </button>
      {error && <p className="mt-1.5 text-center text-xs text-red-400">{error}</p>}
      <p className="mt-1.5 text-center text-xs text-slate-500">
        Payment is held in Zolarux escrow and released only after you confirm delivery.
      </p>
    </div>
  )
}
