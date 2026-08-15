import Link from 'next/link'

export function CoinBalancePanel({ balance }: { balance: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-sx-border bg-sx-surface p-4">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-sx-gray">SX Coins</p>
        <p className="font-display text-xl font-black text-white">🪙 {balance.toLocaleString()}</p>
      </div>
      <Link href="/store" className="rounded-lg bg-sx-purple px-3 py-2 text-xs font-bold text-white hover:bg-sx-purple-light">
        Store →
      </Link>
    </div>
  )
}
