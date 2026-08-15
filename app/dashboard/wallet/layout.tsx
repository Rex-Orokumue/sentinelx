import { WalletSidebar } from '@/components/wallet/WalletSidebar'

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 pb-20">
      <div className="py-8">
        <h1 className="text-2xl font-black text-white">Your Wallet Overview</h1>
        <p className="mt-1 text-sm text-slate-400">Manage your balance, earnings and transactions.</p>
      </div>
      <div className="flex flex-col gap-6 sm:flex-row">
        <WalletSidebar />
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </div>
  )
}
