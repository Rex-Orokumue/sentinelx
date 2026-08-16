'use client'
import { useFormState } from 'react-dom'
import {
  createChallenge,
  updateChallenge,
  toggleChallengeActive,
  type ChallengeActionState,
} from '@/lib/admin/challenge-actions'

export interface AdminChallenge {
  id: string
  slug: string
  title: string
  description: string
  challenge_type: string
  goal: number
  coin_reward: number
  xp_reward: number
  active: boolean
}

const CHALLENGE_TYPES = ['matches_played', 'matches_won', 'post_created', 'reactions_given'] as const

const inputClass =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none'

type ChallengeFormProps = { mode: 'create' } | { mode: 'edit'; item: AdminChallenge }

// mode="create" renders a standalone form block; mode="edit" renders a
// single <tr> (the page places it directly inside a <tbody>) — same split
// as StoreItemForm, same reason: never render "create" inside table markup
// or "edit" outside it.
export function ChallengeForm(props: ChallengeFormProps) {
  if (props.mode === 'create') return <CreateChallengeForm />
  return <EditChallengeRow item={props.item} />
}

function CreateChallengeForm() {
  const [state, action] = useFormState<ChallengeActionState, FormData>(createChallenge, undefined)
  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="text-sm font-bold text-white">Add weekly challenge</h3>
      <div className="grid grid-cols-2 gap-3">
        <input name="slug" placeholder="weekly_something" required className={inputClass} />
        <input name="title" placeholder="Title" required className={inputClass} />
        <select name="challengeType" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Challenge type…
          </option>
          {CHALLENGE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input name="goal" type="number" min={1} placeholder="Goal (e.g. 3)" required className={inputClass} />
        <input name="coinReward" type="number" min={0} placeholder="Coin reward" required className={inputClass} />
        <input name="xpReward" type="number" min={0} placeholder="XP reward" required className={inputClass} />
        <input name="description" placeholder="Description (shown to players)" required className={`${inputClass} col-span-2`} />
      </div>
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-400">Challenge created.</p>}
      <button type="submit" className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500">
        Add challenge
      </button>
    </form>
  )
}

// Two independent forms live side by side in this row's cells — an
// updateChallenge form (title/description/goal/rewards) and a
// toggleChallengeActive form. Sibling <form> elements, each in its own
// <td> — see StoreItemForm's own comment on why nesting them is invalid.
function EditChallengeRow({ item }: { item: AdminChallenge }) {
  const [updateState, updateAction] = useFormState<ChallengeActionState, FormData>(updateChallenge, undefined)
  const [toggleState, toggleAction] = useFormState<ChallengeActionState, FormData>(toggleChallengeActive, undefined)

  return (
    <tr className="border-t border-slate-800 align-top">
      <td className="py-2 pr-3">
        <p className="font-semibold text-white">{item.title}</p>
        <p className="text-xs text-slate-500">
          {item.slug} · {item.challenge_type}
        </p>
      </td>
      <td className="pr-3">
        <form action={updateAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={item.id} />
          <input name="title" defaultValue={item.title} required className={inputClass} />
          <input name="description" defaultValue={item.description} required className={inputClass} />
          <div className="flex gap-2">
            <input name="goal" type="number" min={1} defaultValue={item.goal} required className={`${inputClass} w-20`} />
            <input name="coinReward" type="number" min={0} defaultValue={item.coin_reward} required className={`${inputClass} w-24`} />
            <input name="xpReward" type="number" min={0} defaultValue={item.xp_reward} required className={`${inputClass} w-20`} />
            <button type="submit" className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-bold text-slate-300 hover:border-slate-500">
              Save
            </button>
          </div>
        </form>
        {updateState?.error && <p className="mt-1 text-xs text-red-400">{updateState.error}</p>}
      </td>
      <td className="pr-3">
        <form action={toggleAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="active" value={String(item.active)} />
          <button
            type="submit"
            className={`rounded-lg px-2 py-1 text-xs font-bold ${
              item.active ? 'bg-emerald-600/20 text-emerald-400' : 'bg-slate-700/40 text-slate-400'
            }`}
          >
            {item.active ? 'Active' : 'Inactive'}
          </button>
        </form>
        {toggleState?.error && <p className="mt-1 text-xs text-red-400">{toggleState.error}</p>}
      </td>
    </tr>
  )
}
