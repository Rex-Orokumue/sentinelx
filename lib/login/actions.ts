import { nextLoginState } from './streak'
import { recordCoinTransaction } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export interface DailyLoginResult {
  awardedToday: boolean
  coinsAwarded: number
  xpAwarded: number
  streak: number
  milestone: 'week' | 'month' | null
  deletionRequestedAt: string | null
}

function notAwarded(streak: number, deletionRequestedAt: string | null): DailyLoginResult {
  return { awardedToday: false, coinsAwarded: 0, xpAwarded: 0, streak, milestone: null, deletionRequestedAt }
}

// Best-effort, idempotent per WAT calendar day — mirrors the
// notify()/notifyInApp() convention of never throwing into the caller's
// primary render path. design doc §3.7. Returns what it did (or would have
// done) so /session/start (mobile Phase 1) can report it — the one existing
// web call site (dashboard page) ignores the return value, unchanged.
export async function recordDailyLogin(admin: Admin, playerId: string, now: Date = new Date()): Promise<DailyLoginResult> {
  let profile: { last_login_date: string | null; login_streak: number | null; deletion_requested_at: string | null } | null = null
  try {
    const { data, error: profileErr } = await admin
      .from('profiles')
      .select('last_login_date, login_streak, deletion_requested_at')
      .eq('id', playerId)
      .maybeSingle()

    if (profileErr) {
      // A real read failure — never fall through to the "never logged in
      // before" path, which would reset the player's streak to 1.
      console.error('[recordDailyLogin] profile read failed', { playerId, message: profileErr.message })
      return notAwarded(0, null)
    }
    profile = data
  } catch (err) {
    console.error('[recordDailyLogin] profile read threw', { playerId, message: err instanceof Error ? err.message : String(err) })
    return notAwarded(0, null)
  }

  const deletionRequestedAt = profile?.deletion_requested_at ?? null
  const state = nextLoginState({
    lastLoginDate: profile?.last_login_date ?? null,
    loginStreak: profile?.login_streak ?? 0,
    now,
  })
  if (state.alreadyLoggedToday) return notAwarded(profile?.login_streak ?? 0, deletionRequestedAt)

  let coinsAwarded = 5
  let xpAwarded = 20
  let milestone: 'week' | 'month' | null = null
  if (state.newStreak % 30 === 0) milestone = 'month'
  else if (state.newStreak % 7 === 0) milestone = 'week'
  if (milestone === 'month') { coinsAwarded += 200; xpAwarded += 500 }
  else if (milestone === 'week') { coinsAwarded += 50; xpAwarded += 100 }

  try {
    await admin
      .from('profiles')
      .update({ last_login_date: state.todayWAT, login_streak: state.newStreak })
      .eq('id', playerId)

    await recordCoinTransaction(admin, playerId, 5, 'daily_login', null)
    await awardXP(admin, playerId, 20, 'daily_login', null)

    if (milestone === 'month') {
      await recordCoinTransaction(admin, playerId, 200, 'login_streak', null)
      await awardXP(admin, playerId, 500, 'login_streak', null)
    } else if (milestone === 'week') {
      await recordCoinTransaction(admin, playerId, 50, 'login_streak', null)
      await awardXP(admin, playerId, 100, 'login_streak', null)
    }
  } catch (err) {
    console.error('[recordDailyLogin] failed', { playerId, message: err instanceof Error ? err.message : String(err) })
  }

  return { awardedToday: true, coinsAwarded, xpAwarded, streak: state.newStreak, milestone, deletionRequestedAt }
}
