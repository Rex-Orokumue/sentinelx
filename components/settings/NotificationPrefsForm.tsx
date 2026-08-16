'use client'
import { useFormState } from 'react-dom'
import { updateWhatsappPrefs, type PrefsState } from '@/lib/settings/notification-prefs'

export interface WhatsappPrefs {
  match_reminder: boolean
  result_confirmed: boolean
  prize_credited: boolean
  challenge_completed: boolean
  achievement_unlocked: boolean
  registration_confirmed: boolean
}

const LABELS: [keyof WhatsappPrefs, string][] = [
  ['match_reminder', 'Match reminders (1h before kickoff)'],
  ['result_confirmed', 'Result confirmed'],
  ['prize_credited', 'Prize credited to wallet'],
  ['challenge_completed', 'Weekly challenge completed'],
  ['achievement_unlocked', 'Achievement unlocked'],
  ['registration_confirmed', 'Registration confirmed'],
]

export function NotificationPrefsForm({ prefs, whatsappNumber }: { prefs: WhatsappPrefs; whatsappNumber: string | null }) {
  const [state, formAction] = useFormState<PrefsState, FormData>(updateWhatsappPrefs, undefined)

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">Notifications</h2>
      <p className="mt-1 text-xs text-sx-gray">
        {whatsappNumber ? `Sent to your WhatsApp number: ${whatsappNumber}` : 'No WhatsApp number set — notifications are paused.'}
        {' '}(Update in Profile settings above)
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
