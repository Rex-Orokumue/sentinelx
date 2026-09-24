type Row = Record<string, unknown>

export const FIXTURE_NOW = '2026-09-23T12:00:00.000Z'
export const VIEWER_ID = 'p5'

export const GAMES: Row[] = [
  { id: 'g-dls', name: 'Dream League Soccer', slug: 'dls', category: 'football', active: true },
  { id: 'g-fc', name: 'EA FC Mobile', slug: 'ea-fc-mobile', category: 'football', active: true },
  { id: 'g-ff', name: 'Free Fire', slug: 'free-fire', category: 'shooter', active: true },
]

function profile(i: number, over: Row = {}): Row {
  return {
    id: `p${i}`, username: `player${i}`, display_name: `Player ${i}`, avatar_url: null,
    country: i % 2 ? 'NG' : 'GH',
    wins: 12 - i, losses: i, total_matches: 12, goals_scored: 30 - i, goals_conceded: 10 + i,
    total_titles: i < 3 ? 1 : 0, sx_score: 1000 - i * 20, sentinel_tier: 'trusted', membership_tier: 'bronze',
    kyc_verified: i % 3 === 0, deleted_at: null, equipped_avatar_border: null,
    ...over,
  }
}

// p5 and p6 tie on wins (7 each) so the tie-break cascade is exercised; p9 is a deleted account (tombstone);
// p10 has zero matches and is excluded by the total_matches >= RANKING_MIN_MATCHES filter.
export const PROFILES: Row[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => profile(i, i === 6 ? { wins: 7, losses: 5 } : {})),
  profile(9, { deleted_at: '2026-09-01T00:00:00Z', username: null, display_name: null }),
  profile(10, { total_matches: 0, wins: 0, losses: 0 }),
]

function match(n: number, gameId: string, a: string, b: string, sa: number, sb: number): Row {
  const g = GAMES.find((x) => x.id === gameId)!
  return {
    id: `m${n}`, status: 'completed', round: 'group', score_a: sa, score_b: sb,
    player_a_id: a, player_b_id: b, team_a_id: null, team_b_id: null,
    completed_at: `2026-09-${String(1 + (n % 20)).padStart(2, '0')}T10:00:00Z`,
    tournament: { game: { id: g.id, name: g.name, category: g.category } },
  }
}

export const MATCHES: Row[] = [
  ...Array.from({ length: 16 }, (_, k) => match(k + 1, 'g-dls', `p${(k % 8) + 1}`, `p${((k + 3) % 8) + 1}`, (k * 7) % 4, (k * 5) % 3)),
  ...Array.from({ length: 6 }, (_, k) => match(100 + k, 'g-fc', `p${(k % 4) + 1}`, `p${(k % 4) + 5}`, (k % 3) + 1, k % 2)),
  ...Array.from({ length: 4 }, (_, k) => match(200 + k, 'g-ff', `p${k + 1}`, `p${k + 5}`, 10 + k, 3 + k)),
]

export const SNAPSHOTS: Row[] = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [
  { player_id: `p${i}`, game_id: null, rank: i === 5 ? 4 : i, captured_on: '2026-09-16' },
  { player_id: `p${i}`, game_id: 'g-dls', rank: i, captured_on: '2026-09-16' },
])

export const SEASONS: Row[] = [
  { id: 's1', slug: 'season-1', name: 'Season 1', start_date: '2026-08-01', end_date: '2026-10-31' },
]

export const FIXTURE_TABLES: Record<string, Row[]> = {
  profiles: PROFILES,
  games: GAMES,
  matches: MATCHES,
  player_rank_snapshots: SNAPSHOTS,
  seasons: SEASONS,
  tournaments: [],
  squads: [],
  squad_members: [],
  season_ranking_points: [],
  season_noshow_penalties: [],
  tournament_registrations: [],
  player_achievements: [],
}
