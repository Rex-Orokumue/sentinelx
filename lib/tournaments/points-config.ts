// How a battle-royale result becomes points.
//
// Values below are the games' OWN competitive rulesets, not invented numbers —
// Free Fire World Series for Free Fire, PUBG Mobile Global Championship for
// PUBG. Players arriving from those circuits already know these tables, and a
// scoring system that disagrees with the one they know reads as broken.

export interface PointsConfig {
  /** placement[i] is the award for finishing (i + 1)-th. Beyond the end: zero. */
  placement: number[]
  perKill: number
}

// Keyed by games.slug.
export const DEFAULT_POINTS_CONFIG: Record<string, PointsConfig> = {
  'free-fire': { placement: [12, 9, 8, 7, 6, 5, 4, 3, 2, 1], perKill: 1 },
  'pubg-mobile': { placement: [10, 6, 5, 4, 3, 2, 1, 1], perKill: 1 },
  'cod-mobile': { placement: [10, 6, 5, 4, 3, 2, 1, 1], perKill: 1 },
  'blood-strike': { placement: [10, 6, 5, 4, 3, 2, 1, 1], perKill: 1 },
}

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

// Reads the jsonb blob stored on tournament_stages.points_config.
//
// All-or-nothing on purpose: returns null rather than a partially understood
// config, so the caller falls back to the game default instead of scoring a
// real tournament with a half-read table. Silent partial parsing here would
// produce a wrong scoreboard that looks entirely plausible.
export function parsePointsConfig(raw: unknown): PointsConfig | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>

  if (!Array.isArray(o.placement)) return null
  if (!o.placement.every(isNonNegativeNumber)) return null

  // Absent per_kill means a placement-only ruleset, which is legitimate.
  // Present-but-invalid is a malformed config.
  const perKillRaw = o.per_kill ?? 0
  if (!isNonNegativeNumber(perKillRaw)) return null

  return { placement: o.placement as number[], perKill: perKillRaw }
}

// `placement` is 1-indexed: 1 is the Booyah / WWCD.
export function placementPointsFor(config: PointsConfig, placement: number): number {
  if (!Number.isFinite(placement) || placement < 1) return 0
  return config.placement[Math.trunc(placement) - 1] ?? 0
}

export function scoreLobbyResult(
  config: PointsConfig,
  r: { placement: number; kills: number },
): { placementPoints: number; killPoints: number; totalPoints: number } {
  const placementPoints = placementPointsFor(config, r.placement)
  const kills = Number.isFinite(r.kills) && r.kills > 0 ? Math.trunc(r.kills) : 0
  const killPoints = kills * config.perKill
  return { placementPoints, killPoints, totalPoints: placementPoints + killPoints }
}
