// Season-page copy that was previously safe to hardcode into SeasonHero/
// SeasonLeaderboardTable/ChampionsCupSpotlight because only DLS existed.
// Keyed by game slug (stable — already used for the DLS/FC-Mobile
// game_id lookups in lib/seasons and app pages), same code-level-constant
// pattern as CATEGORY_META (lib/games/categories.ts), not a DB table:
// tournament.title stays the source of truth for any single tournament's
// name, this is only for the season page's aggregate copy.
export interface SeasonTierLabels {
  /** Pluralized — always used as "{n} {communityClub} completed". */
  communityClub: string
  /** Pluralized — always used as "{n} {masters} completed". */
  masters: string
  /** Shown under the season leaderboard table. */
  qualificationNote: string
  /** Whether this game has a season finale worth its own spotlight section. */
  showChampionsCupSpotlight: boolean
}

const SEASON_TIER_LABELS: Record<string, SeasonTierLabels> = {
  dls: {
    communityClub: 'Community Clubs',
    masters: 'Masters',
    qualificationNote: 'Qualify for Champions Cup — top 16 at season end earn an invitation.',
    showChampionsCupSpotlight: true,
  },
  'ea-fc-mobile': {
    communityClub: 'Circuit Cups',
    masters: 'Elite Cups',
    qualificationNote: 'Top 16 monthly Circuit Cup points earn an Elite Cup invitation.',
    showChampionsCupSpotlight: false,
  },
}

const DEFAULT_SEASON_TIER_LABELS: SeasonTierLabels = {
  communityClub: 'Community Tournaments',
  masters: 'Masters',
  qualificationNote: 'Top ranked players earn an invitation to the next tier.',
  showChampionsCupSpotlight: false,
}

export function seasonTierLabelsFor(gameSlug: string): SeasonTierLabels {
  return SEASON_TIER_LABELS[gameSlug] ?? DEFAULT_SEASON_TIER_LABELS
}
