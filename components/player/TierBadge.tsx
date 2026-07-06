const TIER: Record<string, { label: string; cls: string }> = {
  elite:      { label: '🟢 Elite',      cls: 'text-emerald-400' },
  trusted:    { label: '🔵 Trusted',    cls: 'text-blue-400' },
  developing: { label: '🟡 Developing', cls: 'text-violet-400' },
  at_risk:    { label: '🔴 At Risk',    cls: 'text-red-400' },
}

// Returns null for a null or unrecognized tier (matches the home page's prior
// `{tier && …}` guard). Tiers are a fixed set, so unrecognized shouldn't occur.
export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null
  const t = TIER[tier]
  if (!t) return null
  return <span className={`text-[11px] ${t.cls}`}>{t.label}</span>
}
