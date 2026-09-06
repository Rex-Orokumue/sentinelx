import { createAdminClient } from '@/lib/supabase/admin'
import { toDateTimeLocal } from '@/lib/format'
import { RANKING_MIN_MATCHES, type PlayerStatsInput } from '@/lib/rankings/leaderboard'
import {
  buildGameSnapshotRows,
  buildGlobalSnapshotRows,
  type GameWinEntry,
  type SnapshotRow,
} from '@/lib/rankings/snapshot'
import { matchWinnerId } from '@/lib/tournaments/advancement'

type RawGameRef = { id: string; name: string } | { id: string; name: string }[] | null
type RawTournamentRef = { game: RawGameRef } | { game: RawGameRef }[] | null

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v
}

/** Today's date in WAT as YYYY-MM-DD. The platform's day boundary is Lagos, not
 *  UTC, so a run just after midnight WAT must stamp the new day. Reuses the
 *  single WAT conversion in lib/format rather than adding a second one. */
function todayInWat(): string {
  return toDateTimeLocal(new Date().toISOString()).slice(0, 10)
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const capturedOn = todayInWat()

  const [{ data: profiles }, { data: matchRows }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, wins, losses, total_matches, goals_scored, goals_conceded, total_titles, sx_score')
      .gte('total_matches', RANKING_MIN_MATCHES),
    admin
      .from('matches')
      .select(
        'status, score_a, score_b, player_a_id, player_b_id, ' +
          'tournament:tournaments(game:games(id, name))',
      )
      .eq('status', 'completed'),
  ])

  // Only the fields the ranking sort actually reads. The per-category and
  // per-game goal aggregates the page builds are irrelevant here: the global
  // board ranks on SX Score and the per-game boards rank on wins.
  const players: PlayerStatsInput[] = (profiles ?? []).map(
    (p) =>
      ({
        id: p.id,
        username: null,
        displayName: null,
        avatarUrl: null,
        country: null,
        wins: p.wins,
        losses: p.losses,
        totalMatches: p.total_matches,
        goalsScored: p.goals_scored,
        goalsConceded: p.goals_conceded,
        categoryStats: [],
        gameStats: [],
        winsByGame: [],
        totalTitles: p.total_titles,
        sxScore: p.sx_score,
        sentinelTier: null,
        membershipTier: 'recruit',
        // Not read by either ranking sort; present to satisfy the shared type.
        kycVerified: false,
      }) satisfies PlayerStatsInput,
  )

  const sxScoreById = new Map(players.map((p) => [p.id, p.sxScore]))

  // Wins per (player, game) keyed by game **id** — winsByPlayerAndGame groups
  // by game name, which cannot address a game_id column.
  const winsByGameId = new Map<string, Map<string, number>>()
  for (const raw of (matchRows as unknown[] | null) ?? []) {
    const m = raw as {
      status: string
      score_a: number | null
      score_b: number | null
      player_a_id: string | null
      player_b_id: string | null
      tournament: RawTournamentRef
    }
    const gameId = one(one(m.tournament)?.game ?? null)?.id
    if (!gameId) continue
    const winner = matchWinnerId(m)
    if (!winner) continue
    const byPlayer = winsByGameId.get(gameId) ?? new Map<string, number>()
    byPlayer.set(winner, (byPlayer.get(winner) ?? 0) + 1)
    winsByGameId.set(gameId, byPlayer)
  }

  const globalRows = buildGlobalSnapshotRows(players, capturedOn)

  const gameRows: SnapshotRow[] = []
  winsByGameId.forEach((byPlayer, gameId) => {
    const entries: GameWinEntry[] = []
    byPlayer.forEach((wins, playerId) => {
      // A player must still be ranking-eligible to appear in history.
      if (!sxScoreById.has(playerId)) return
      entries.push({ playerId, wins, sxScore: sxScoreById.get(playerId) ?? 0 })
    })
    gameRows.push(...buildGameSnapshotRows(entries, gameId, capturedOn))
  })

  // Both scopes share one conflict target: scope_key is a generated column that
  // collapses a NULL game_id to a sentinel uuid, so an ordinary (inferable)
  // unique index covers global and per-game rows alike. See migration 081 —
  // partial indexes cannot be ON CONFLICT targets.
  const errors: string[] = []
  if (globalRows.length > 0) {
    const { error } = await admin
      .from('player_rank_snapshots')
      .upsert(globalRows, { onConflict: 'player_id,scope_key,captured_on', ignoreDuplicates: false })
    if (error) errors.push(`global: ${error.message}`)
  }
  if (gameRows.length > 0) {
    const { error } = await admin
      .from('player_rank_snapshots')
      .upsert(gameRows, { onConflict: 'player_id,scope_key,captured_on', ignoreDuplicates: false })
    if (error) errors.push(`games: ${error.message}`)
  }

  // A snapshot job that silently writes nothing is worse than one that fails
  // loudly — the Trend column would just stay empty with no signal why.
  if (errors.length > 0) {
    return Response.json({ ok: false, capturedOn, errors }, { status: 500 })
  }

  return Response.json({
    ok: true,
    capturedOn,
    global: globalRows.length,
    games: winsByGameId.size,
    rows: globalRows.length + gameRows.length,
  })
}
