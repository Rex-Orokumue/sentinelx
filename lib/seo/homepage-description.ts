import { SITE_DESCRIPTION } from './site'

export function homepageDescription(liveTournamentTitle: string | null): string {
  if (!liveTournamentTitle) return SITE_DESCRIPTION
  return `${liveTournamentTitle} is live now on Sentinel X — Nigeria's home of mobile esports. Compete, watch, and climb the leaderboard.`
}
