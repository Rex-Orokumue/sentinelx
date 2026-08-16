'use client'
import { useFormState } from 'react-dom'
import { updateAchievementSharingPrefs, type PrefsState } from '@/lib/settings/notification-prefs'

export interface AchievementSharingPrefs {
  tournament: boolean
  milestone: boolean
  streak: boolean
  social: boolean
  other: boolean
}

const LABELS: [keyof AchievementSharingPrefs, string][] = [
  ['tournament', 'Tournament wins'],
  ['milestone', 'Milestone achievements (100 matches, etc.)'],
  ['streak', 'Streak achievements'],
  ['social', 'Social achievements (reactions, posts)'],
  ['other', 'All other achievements'],
]

export function AchievementSharingForm({ prefs }: { prefs: AchievementSharingPrefs }) {
  const [state, formAction] = useFormState<PrefsState, FormData>(updateAchievementSharingPrefs, undefined)

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">Achievement Sharing</h2>
      <p className="mt-1 text-xs text-sx-gray">
        When you unlock an achievement, auto-post it to the community feed for others to celebrate.
      </p>
      <form action={formAction} className="mt-4 space-y-3 border-t border-sx-border pt-4">
        {LABELS.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between text-sm text-white">
            {label}
            <input type="checkbox" name={key} defaultChecked={prefs[key]} className="h-5 w-5 accent-sx-purple" />
          </label>
        ))}
        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        {state?.success && <p className="text-sm text-emerald-400">Saved.</p>}
        <button type="submit" className="rounded-lg bg-sx-purple px-5 py-2.5 text-sm font-bold text-white hover:bg-sx-purple-light">
          Save Changes
        </button>
      </form>
    </section>
  )
}
