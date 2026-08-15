import { nextLoginState } from './streak'
import { awardCoins } from '@/lib/coins/service'
import { awardXP } from '@/lib/membership/xp'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Best-effort, idempotent per WAT calendar day — mirrors the
// notify()/notifyInApp() convention of never throwing into the caller's
// primary render path. design doc §3.7.
export async function recordDailyLogin(admin: Admin, playerId: string, now: Date = new Date()): Promise<void> {
  try {
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('last_login_date, login_streak')
      .eq('id', playerId)
      .maybeSingle()

    if (profileErr) {
      // A real read failure — never fall through to the "never logged in
      // before" path, which would reset the player's streak to 1.
      console.error('[recordDailyLogin] profile read failed', { playerId, message: profileErr.message })
      return
    }

    const state = nextLoginState({
      lastLoginDate: profile?.last_login_date ?? null,
      loginStreak: profile?.login_streak ?? 0,
      now,
    })
    if (state.alreadyLoggedToday) return

    await admin
      .from('profiles')
      .update({ last_login_date: state.todayWAT, login_streak: state.newStreak })
      .eq('id', playerId)

    await awardCoins(admin, playerId, 5, 'daily_login', null)
    await awardXP(admin, playerId, 20, 'daily_login', null)

    if (state.newStreak % 30 === 0) {
      await awardCoins(admin, playerId, 200, 'login_streak', null)
      await awardXP(admin, playerId, 500, 'login_streak', null)
    } else if (state.newStreak % 7 === 0) {
      await awardCoins(admin, playerId, 50, 'login_streak', null)
      await awardXP(admin, playerId, 100, 'login_streak', null)
    }
  } catch (err) {
    console.error('[recordDailyLogin] failed', { playerId, message: err instanceof Error ? err.message : String(err) })
  }
}
