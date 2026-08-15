'use client'
import { useFormState } from 'react-dom'
import {
  grantCoins,
  deductCoins,
  grantXp,
  manuallyUnlockAchievement,
  type EconomyActionState,
} from '@/lib/admin/player-economy-actions'
import { formatDateTime } from '@/lib/format'

export interface UnlockedAchievement {
  achievementId: string
  unlockedAt: string
}

export interface AdminAchievement {
  id: string
  name: string
  category: string
}

const inputClass =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none'

export function PlayerEconomyPanel({
  playerId,
  coinBalance,
  totalEarned,
  totalSpent,
  xp,
  membershipTier,
  unlockedAchievements,
  allAchievements,
}: {
  playerId: string
  coinBalance: number
  totalEarned: number
  totalSpent: number
  xp: number
  membershipTier: string
  unlockedAchievements: UnlockedAchievement[]
  allAchievements: AdminAchievement[]
}) {
  const unlockedIds = new Set(unlockedAchievements.map((a) => a.achievementId))
  const locked = allAchievements.filter((a) => !unlockedIds.has(a.id))

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-2 text-sm font-bold text-white">SX Coins</h2>
        <p className="text-sm text-slate-300">
          Balance <span className="font-bold text-emerald-400">{coinBalance}</span> · Earned {totalEarned} · Spent{' '}
          {totalSpent}
        </p>
        <p className="mt-1 text-sm text-slate-300">
          XP <span className="font-bold text-violet-400">{xp}</span> · {membershipTier}
        </p>
      </div>

      <GrantCoinsForm playerId={playerId} />
      <DeductCoinsForm playerId={playerId} />
      <GrantXpForm playerId={playerId} />

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-bold text-white">Achievements</h3>
        {unlockedAchievements.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No achievements unlocked yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {unlockedAchievements.map((a) => {
              const achievement = allAchievements.find((x) => x.id === a.achievementId)
              return (
                <li key={a.achievementId} className="text-xs text-slate-300">
                  {achievement?.name ?? a.achievementId} — unlocked {formatDateTime(a.unlockedAt)}
                </li>
              )
            })}
          </ul>
        )}
        <ManualUnlockForm playerId={playerId} locked={locked} />
      </div>
    </div>
  )
}

function GrantCoinsForm({ playerId }: { playerId: string }) {
  const [state, action] = useFormState<EconomyActionState, FormData>(grantCoins, undefined)
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-bold text-white">Grant SX Coins</h3>
      <input type="hidden" name="playerId" value={playerId} />
      <div className="grid grid-cols-2 gap-3">
        <input name="amount" type="number" min={1} placeholder="Amount" required className={inputClass} />
        <input name="reason" placeholder="Reason (required)" required className={inputClass} />
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-400">Granted.</p>}
      <button
        type="submit"
        className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
      >
        Grant coins
      </button>
    </form>
  )
}

function DeductCoinsForm({ playerId }: { playerId: string }) {
  const [state, action] = useFormState<EconomyActionState, FormData>(deductCoins, undefined)
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-bold text-white">Deduct SX Coins</h3>
      <input type="hidden" name="playerId" value={playerId} />
      <div className="grid grid-cols-2 gap-3">
        <input name="amount" type="number" min={1} placeholder="Amount" required className={inputClass} />
        <input name="reason" placeholder="Reason (required)" required className={inputClass} />
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-400">Deducted.</p>}
      <button
        type="submit"
        className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
      >
        Deduct coins
      </button>
    </form>
  )
}

function GrantXpForm({ playerId }: { playerId: string }) {
  const [state, action] = useFormState<EconomyActionState, FormData>(grantXp, undefined)
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-bold text-white">Grant XP</h3>
      <input type="hidden" name="playerId" value={playerId} />
      <div className="grid grid-cols-2 gap-3">
        <input name="amount" type="number" min={1} placeholder="Amount" required className={inputClass} />
        <input name="reason" placeholder="Reason (required)" required className={inputClass} />
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-400">Granted.</p>}
      <button
        type="submit"
        className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
      >
        Grant XP
      </button>
    </form>
  )
}

function ManualUnlockForm({ playerId, locked }: { playerId: string; locked: AdminAchievement[] }) {
  const [state, action] = useFormState<EconomyActionState, FormData>(manuallyUnlockAchievement, undefined)
  if (locked.length === 0) return null
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
      <input type="hidden" name="playerId" value={playerId} />
      <select name="achievementId" required className={inputClass}>
        <option value="">Manually unlock…</option>
        {locked.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} ({a.category})
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
      >
        Unlock
      </button>
      {state?.error && <p className="w-full text-xs text-red-400">{state.error}</p>}
      {state?.success && <p className="w-full text-xs text-emerald-400">Unlocked.</p>}
    </form>
  )
}
