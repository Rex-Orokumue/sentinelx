'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { updatePushPrefs, type PrefsState } from '@/lib/settings/notification-prefs'
import { requestPushPermission, disablePush } from '@/components/notifications/useFCM'

export interface PushPrefs {
  match_reminder: boolean
  result_confirmed: boolean
  achievement_unlocked: boolean
  challenge_completed: boolean
  new_announcement: boolean
  tournament_announced: boolean
  wager_settled: boolean
  referral_converted: boolean
  post_comment: boolean
  post_reaction: boolean
  bracket_released: boolean
  match_assigned: boolean
  prize_credited: boolean
}

const LABELS: [keyof PushPrefs, string][] = [
  ['match_reminder', 'Match reminders'],
  ['match_assigned', 'New fixture assigned'],
  ['bracket_released', 'Bracket released'],
  ['result_confirmed', 'Result confirmed'],
  ['prize_credited', 'Prize credited'],
  ['achievement_unlocked', 'Achievement unlocked'],
  ['challenge_completed', 'Weekly challenge completed'],
  ['wager_settled', 'Wager settled'],
  ['referral_converted', 'Referral converted'],
  ['post_comment', 'Comments on your posts'],
  ['post_reaction', 'Reactions on your posts'],
  ['new_announcement', 'Community announcements'],
  ['tournament_announced', 'New tournaments'],
]

export function PushPrefsForm({ prefs, enabled }: { prefs: PushPrefs; enabled: boolean }) {
  const [state, formAction] = useFormState<PrefsState, FormData>(updatePushPrefs, undefined)
  const [pushEnabled, setPushEnabled] = useState(enabled)
  const [busy, setBusy] = useState(false)
  const [customize, setCustomize] = useState(false)

  async function handleToggle() {
    setBusy(true)
    if (pushEnabled) {
      await disablePush()
      setPushEnabled(false)
    } else {
      const ok = await requestPushPermission()
      setPushEnabled(ok)
    }
    setBusy(false)
  }

  return (
    <section className="rounded-2xl border border-sx-border bg-sx-surface p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white">Push Notifications</h2>
      <p className="mt-1 text-xs text-sx-gray">Receive browser notifications even when you&apos;re not on the site.</p>
      <div className="mt-4 flex items-center justify-between border-t border-sx-border pt-4">
        <span className="text-sm text-white">Status: {pushEnabled ? '✅ Enabled' : 'Not enabled'}</span>
        <button
          type="button"
          onClick={handleToggle}
          disabled={busy}
          className="rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white hover:bg-sx-purple-light disabled:opacity-60"
        >
          {pushEnabled ? 'Disable' : 'Enable Push Notifications'}
        </button>
      </div>
      {pushEnabled && (
        <>
          <button type="button" onClick={() => setCustomize((c) => !c)} className="mt-3 text-xs text-sx-purple-text hover:underline">
            {customize ? 'Hide' : 'Customize →'}
          </button>
          {customize && (
            <form action={formAction} className="mt-3 space-y-3 border-t border-sx-border pt-4">
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
          )}
        </>
      )}
    </section>
  )
}
