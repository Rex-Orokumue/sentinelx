export interface ComingSoonFeature {
  title: string
  blurb: string
}

const FEATURES: Record<string, ComingSoonFeature> = {
  Watch: {
    title: 'Watch',
    blurb: 'Live streams, highlights, and match replays on Sentinel X TV. Coming soon.',
  },
  Community: {
    title: 'Community',
    blurb: 'Posts, discussions, and announcements from the arena. Coming soon.',
  },
  Trade: {
    title: 'Trade',
    blurb: 'The Gaming Exchange for accounts, coins, and gear, secured by escrow. Coming soon.',
  },
}

const FALLBACK: ComingSoonFeature = {
  title: 'Coming soon',
  blurb: 'This part of Sentinel X is on the way.',
}

export function resolveComingSoon(feature: string | undefined): ComingSoonFeature {
  if (!feature) return FALLBACK
  return FEATURES[feature] ?? FALLBACK
}
