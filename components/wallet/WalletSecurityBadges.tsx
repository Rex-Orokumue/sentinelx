export function WalletSecurityBadges({ kycVerified }: { kycVerified: boolean }) {
  const badges = [
    { icon: '🛡', label: 'Wallet Protected', sub: 'Zolarux Escrow Active' },
    { icon: kycVerified ? '✅' : '⏳', label: 'Verified Account', sub: kycVerified ? 'KYC Verified' : 'Pending Verification' },
    { icon: '🔒', label: 'Escrow Enabled', sub: 'All Transactions Safe' },
  ]
  return (
    <div className="space-y-2 rounded-2xl border border-sx-border bg-sx-surface p-4">
      {badges.map((b) => (
        <div key={b.label} className="flex items-center gap-2 text-sm">
          <span>{b.icon}</span>
          <div>
            <p className="font-semibold text-white">{b.label}</p>
            <p className="text-xs text-sx-gray">{b.sub}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
