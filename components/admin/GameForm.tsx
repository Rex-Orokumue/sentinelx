'use client'
import { useFormState } from 'react-dom'
import { createGame, type GameFormState } from '@/lib/games/admin-actions'

export function GameForm() {
  const [state, action] = useFormState<GameFormState, FormData>(createGame, undefined)

  if (state?.success) return <p className="text-sm text-emerald-400">Game added.</p>

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <h3 className="text-sm font-bold text-white">Add a game</h3>
      <input
        name="name"
        type="text"
        placeholder="Game name"
        required
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <select
        name="category"
        defaultValue="football"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
      >
        <option value="football">Football</option>
        <option value="fighting">Fighting</option>
        <option value="shooter">Shooter</option>
        <option value="other">Other</option>
      </select>
      <input
        name="iconUrl"
        type="text"
        placeholder="Icon URL (optional)"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button type="submit" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        Add game
      </button>
    </form>
  )
}
