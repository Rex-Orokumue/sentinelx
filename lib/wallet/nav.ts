// Wallet section nav — spec §2, corrected: Deposit is live (see plan's
// Global Constraints), not Phase 3+.
export interface WalletNavItem {
  label: string
  href: string
  locked: boolean
  icon: string
}

export const WALLET_NAV_ITEMS: WalletNavItem[] = [
  { label: 'Overview', href: '/dashboard/wallet', locked: false, icon: '📊' },
  { label: 'Transactions', href: '/dashboard/wallet/transactions', locked: false, icon: '🧾' },
  { label: 'Deposit', href: '/dashboard/wallet/deposit', locked: false, icon: '⬇' },
  { label: 'Withdraw', href: '/dashboard/wallet/withdraw', locked: false, icon: '⬆' },
  { label: 'Payment Methods', href: '/dashboard/wallet/payment-methods', locked: false, icon: '💳' },
  { label: 'Transfer', href: '/dashboard/wallet/transfer', locked: true, icon: '↔' },
  { label: 'Rewards', href: '/dashboard/wallet/rewards', locked: true, icon: '🎁' },
  { label: 'Referrals', href: '/dashboard/wallet/referrals', locked: true, icon: '👥' },
]
