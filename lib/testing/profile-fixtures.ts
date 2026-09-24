import { PROFILES, SEASON_FIXTURE_TABLES } from './progress-fixtures'

type Row = Record<string, unknown>

// p1 is the OWNER: the only player with season points in SEASON_FIXTURE_TABLES, so the owner-only Season Standing
// card is non-trivial. p2 is the public TARGET (loses to p1 in the masters final, so p1 is not champion; p2 is).
export const OWNER_ID = 'p1'
export const OWNER_USERNAME = 'player1'
export const TARGET_ID = 'p2'
export const TARGET_USERNAME = 'player2'
export const THIRD_ID = 'p3'
export const THIRD_USERNAME = 'player3'
export const DELETED_USERNAME = 'ghost'
export const OWNER_COIN_BALANCE = 1234

// Locked for the target (p2) — only counts may ever leave the server for these (spec §4).
export const LOCKED_ONLY_ACHIEVEMENT_NAMES = ['Secret Locked Alpha', 'Secret Locked Beta', 'Secret Locked Gamma']

export const PROFILE_RPC = { player_rank: () => 3 }

const profiles: Row[] = [
  ...PROFILES.map((p) => ({
    ...p,
    bio: p.username ? `Bio of ${String(p.username)}` : null,
    created_at: '2026-01-15T09:00:00Z',
    xp: 1500,
    membership_tier: 'guardian',
  })),
  {
    id: 'p11', username: DELETED_USERNAME, display_name: 'Ghost', avatar_url: null, country: 'NG', bio: null,
    created_at: '2026-01-01T00:00:00Z', sx_score: 700, sentinel_tier: 'developing', total_matches: 3, wins: 1, losses: 2,
    goals_scored: 3, goals_conceded: 5, total_titles: 0, xp: 10, membership_tier: 'recruit',
    equipped_avatar_border: null, deleted_at: '2026-09-02T00:00:00Z',
  },
]

const achievements: Row[] = [
  { id: 'a1', slug: 'first-blood', name: 'First Blood', description: 'Win your first match.', category: 'matches', sort_order: 1 },
  { id: 'a2', slug: 'champion', name: 'Champion', description: 'Win a tournament.', category: 'tournaments', sort_order: 2 },
  { id: 'a3', slug: 'secret-alpha', name: 'Secret Locked Alpha', description: 'Hidden alpha description.', category: 'secret', sort_order: 3 },
  { id: 'a4', slug: 'secret-beta', name: 'Secret Locked Beta', description: 'Hidden beta description.', category: 'secret', sort_order: 4 },
  { id: 'a5', slug: 'secret-gamma', name: 'Secret Locked Gamma', description: 'Hidden gamma description.', category: 'secret', sort_order: 5 },
]

// Rarity: a1 held by p2+p3 (2), a2 held by p2 only (1) → a2 is rarer; a3 held by p3 only (locked for the target).
const playerAchievements: Row[] = [
  { player_id: 'p2', achievement_id: 'a1', unlocked_at: '2026-08-01T10:00:00Z' },
  { player_id: 'p2', achievement_id: 'a2', unlocked_at: '2026-09-20T18:30:00Z' },
  { player_id: 'p3', achievement_id: 'a1', unlocked_at: '2026-08-05T10:00:00Z' },
  { player_id: 'p3', achievement_id: 'a3', unlocked_at: '2026-09-01T10:00:00Z' },
]

const tournamentRef = { title: 'Masters Cup', slug: 'masters-cup', tournament_end: '2026-09-20T18:00:00Z', game: { id: 'g-dls', name: 'Dream League Soccer', category: 'football' } }
const player = (i: number) => ({ username: `player${i}`, display_name: `Player ${i}` })

// Every completed match involves p1 and/or p2 only: the fake does NOT narrow .or() filters, so the whole table is
// what each profile query "matches". p1 and p2 read it from their own perspective.
const matches: Row[] = [
  {
    id: 'pm1', status: 'completed', round: 'group', score_a: 2, score_b: 0, completed_at: '2026-09-18T10:00:00Z',
    player_a_id: 'p2', player_b_id: 'p1', team_a_id: null, team_b_id: null,
    tournament: tournamentRef, player_a: player(2), player_b: player(1), team_a: null, team_b: null,
  },
  {
    id: 'pm2', status: 'completed', round: 'group', score_a: 3, score_b: 1, completed_at: '2026-09-17T10:00:00Z',
    player_a_id: 'p2', player_b_id: 'p3', team_a_id: null, team_b_id: null,
    tournament: tournamentRef, player_a: player(2), player_b: null, team_a: null, team_b: null, // null embed → "TBD"
  },
  {
    id: 'pm3', status: 'completed', round: 'group', score_a: 0, score_b: 1, completed_at: '2026-09-16T10:00:00Z',
    player_a_id: 'p2', player_b_id: 'p1', team_a_id: null, team_b_id: null,
    tournament: tournamentRef, player_a: player(2), player_b: player(1), team_a: null, team_b: null,
  },
  {
    id: 'pm4', status: 'completed', round: 'group', score_a: 2, score_b: 2, completed_at: '2026-09-15T10:00:00Z',
    player_a_id: null, player_b_id: null, team_a_id: 'sq1', team_b_id: 'sq2',
    tournament: tournamentRef, player_a: null, player_b: null,
    team_a: { id: 'sq1', name: 'Alpha Squad' }, team_b: { id: 'sq2', name: 'Bravo Squad' },
  },
  {
    id: 'pm5', status: 'completed', round: 'final', score_a: 3, score_b: 1, completed_at: '2026-09-20T17:00:00Z',
    player_a_id: 'p2', player_b_id: 'p1', team_a_id: null, team_b_id: null,
    tournament: tournamentRef, player_a: player(2), player_b: player(1), team_a: null, team_b: null,
  },
]

export const PROFILE_TABLES: Record<string, Row[]> = {
  ...SEASON_FIXTURE_TABLES,
  profiles,
  matches,
  achievements,
  player_achievements: playerAchievements,
  squads: [{ id: 'sq1', name: 'Alpha Squad' }, { id: 'sq2', name: 'Bravo Squad' }],
  squad_members: [{ squad_id: 'sq1', player_id: 'p2' }],
  // p1's row keeps the season fixture's active registration; p2's are paid but 'withdrawn' so they stay off the season board.
  tournament_registrations: [
    ...(SEASON_FIXTURE_TABLES.tournament_registrations ?? []).map((r) => ({ ...r, payment_status: 'paid' })),
    { tournament_id: 'x1', player_id: 'p2', status: 'withdrawn', payment_status: 'paid' },
    { tournament_id: 'x2', player_id: 'p2', status: 'withdrawn', payment_status: 'paid' },
  ],
  community_posts: [
    { id: 'c1', author_id: 'p2', content: 'gg everyone', post_type: 'text', image_url: null, is_deleted: false, created_at: '2026-09-19T10:00:00Z' },
    { id: 'c2', author_id: 'p2', content: 'clutch win', post_type: 'image', image_url: 'https://cdn.test/c2.jpg', is_deleted: false, created_at: '2026-09-18T10:00:00Z' },
    { id: 'c3', author_id: 'p2', content: 'deleted post', post_type: 'text', image_url: null, is_deleted: true, created_at: '2026-09-17T10:00:00Z' },
  ],
  player_store_items: [
    { player_id: 'p2', item_id: 'i1', equipped: true, store_items: { slug: 'avatar_border_purple_glow', category: 'avatar_border' } },
  ],
  sx_coins: [{ player_id: OWNER_ID, balance: OWNER_COIN_BALANCE }],
  // Embedded relation objects ride on the row (the fake ignores selects): fetchFollowers reads `follower`,
  // fetchFollowing reads `following`.
  player_follows: [
    followRow('p1', 'p2', '2026-09-10T10:00:00Z'),
    followRow('p2', 'p3', '2026-09-11T10:00:00Z'),
    followRow('p3', 'p2', '2026-09-12T10:00:00Z'),
  ],
}

function ref(id: string): Row {
  const p = profiles.find((x) => x.id === id)!
  return { id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url, membership_tier: p.membership_tier }
}
function followRow(follower: string, following: string, createdAt: string): Row {
  return { follower_id: follower, following_id: following, created_at: createdAt, follower: ref(follower), following: ref(following) }
}
