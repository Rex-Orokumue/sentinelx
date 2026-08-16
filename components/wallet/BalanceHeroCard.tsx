'use client'
import { useState } from 'react'
import Image from 'next/image'
import { formatNaira } from '@/lib/format'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'

// Balance = wallets.balance directly — already net of any pending
// withdrawal debit (debitWallet subtracts at request time, not at payout).
// See plan Global Constraints for why this isn't "Total − Pending".
//
// mascotUrl is resolved server-side (page.tsx, via findOptionalPublicImage)
// and passed in as a prop — that helper reads the filesystem (`fs`/`path`)
// and cannot be called from this 'use client' component directly (it's
// needed here for the hide/show balance toggle's useState).
export function BalanceHeroCard({
  balance,
  pendingWithdrawal,
  mascotUrl,
}: {
  balance: number
  pendingWithdrawal: number
  mascotUrl: string | null
}) {
  const [hidden, setHidden] = useState(false)

  return (
    <div className="relative overflow-hidden rounded-2xl border border-sx-purple/50 bg-gradient-to-r from-sx-purple/30 via-sx-surface to-sx-purple/10 p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -bottom-6 h-40 w-40 rounded-full bg-sx-purple/20 blur-[60px]"
      />
      <div className="relative grid gap-4 sm:grid-cols-[1fr_120px]">
        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-widest text-sx-gray">Total Balance</p>
            <button
              type="button"
              onClick={() => setHidden((h) => !h)}
              className="text-sx-gray hover:text-white"
              aria-label={hidden ? 'Show balance' : 'Hide balance'}
            >
              {hidden ? '🙈' : '👁'}
            </button>
          </div>
          <p className="mt-1 font-display text-5xl font-black text-white">{hidden ? '••••••' : formatNaira(balance)}</p>
          <span className="mt-2 inline-block rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
            Available Balance
          </span>
          {pendingWithdrawal > 0 && (
            <p className="mt-2 text-sm text-amber-400">
              ⏳ {formatNaira(pendingWithdrawal)} pending withdrawal — processed within 24 hours
            </p>
          )}
        </div>
        {mascotUrl ? (
          <Image
            src={mascotUrl}
            alt="Sentinel X mascot"
            width={120}
            height={140}
            className="hidden h-full w-auto object-contain sm:block"
          />
        ) : (
          <ImagePlaceholder
            className="hidden h-full sm:flex"
            label={'Sentinel mascot — holding phone/tablet pose\n(public/mascot/mascot-wallet.png)'}
          />
        )}
      </div>
    </div>
  )
}
