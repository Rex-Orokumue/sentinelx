// Wallet section nav — spec §2, corrected: Deposit is live (see plan's
// Global Constraints), not Phase 3+.
export interface WalletNavItem {
  label: string
  href: string
  locked: boolean
}

export const WALLET_NAV_ITEMS: WalletNavItem[] = [
  { label: 'Overview', href: '/dashboard/wallet', locked: false },
  { label: 'Transactions', href: '/dashboard/wallet/transactions', locked: false },
  { label: 'Deposit', href: '/dashboard/wallet/deposit', locked: false },
  { label: 'Withdraw', href: '/dashboard/wallet/withdraw', locked: false },
  { label: 'Payment Methods', href: '/dashboard/wallet/payment-methods', locked: false },
  { label: 'Transfer', href: '/dashboard/wallet/transfer', locked: true },
  { label: 'Rewards', href: '/dashboard/wallet/rewards', locked: true },
  { label: 'Referrals', href: '/dashboard/wallet/referrals', locked: true },
]
