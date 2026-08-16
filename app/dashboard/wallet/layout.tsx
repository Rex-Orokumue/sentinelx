import { WalletSidebar } from '@/components/wallet/WalletSidebar'

// Widened to max-w-6xl (was max-w-4xl) and the heading moved inside the
// content column, alongside — not above — the sidebar: in the reference
// mockup (public/visual_bible/wallet_page.jpeg) the "WALLET" eyebrow and
// "Your Wallet Overview" heading sit on the same row, not with the heading
// spanning full width above a narrower two-column body.
export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20">
      <div className="flex flex-col gap-6 py-8 sm:flex-row">
        <WalletSidebar />
        <div className="min-w-0 flex-1 space-y-6">
          <div>
            <h1 className="text-2xl font-black text-white">Your Wallet Overview</h1>
            <p className="mt-1 text-sm text-slate-400">Manage your balance, earnings and transactions.</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
