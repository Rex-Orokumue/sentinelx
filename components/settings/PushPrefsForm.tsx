'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { updatePushPrefs, type PrefsState } from '@/lib/settings/notification-prefs'
import { requestPushPermission, disablePush } from '@/components/notifications/useFCM'
import { sendTestPush, type TestPushResult } from '@/lib/notifications/test-push'
import { MuteTypeRow } from './MuteTypeRow'

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
  status_from_friend: boolean
  status_viewed: boolean
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
  ['status_from_friend', 'A friend posts a status'],
  ['status_viewed', 'Someone views your status'],
  ['new_announcement', 'Community announcements'],
  ['tournament_announced', 'New tournaments'],
]

export function PushPrefsForm({
  prefs,
  enabled,
  mutedTypes = {},
}: {
  prefs: PushPrefs
  enabled: boolean
  // type -> muted_until. "Always" arrives as a far-future timestamp, so both
  // kinds of mute render through one path.
  mutedTypes?: Record<string, string>
}) {
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
      {/* Per device, and said so plainly: enabling and disabling both act on
          the browser you are currently using, and each device is separate.
          Previously "Disable" removed every device at once, so turning push
          off on a phone silently killed it on a laptop with no hint why. */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-sx-border pt-4">
        <span className="text-sm text-white">
          Status on this device: {pushEnabled ? '✅ Enabled' : 'Not enabled'}
        </span>
        <button
          type="button"
          onClick={handleToggle}
          disabled={busy}
          className="shrink-0 rounded-lg bg-sx-purple px-4 py-2 text-xs font-bold text-white hover:bg-sx-purple-light disabled:opacity-60"
        >
          {pushEnabled ? 'Disable on this device' : 'Enable Push Notifications'}
        </button>
      </div>
      <p className="mt-2 text-xs text-sx-gray">
        Each device is separate — enable it on your phone and your laptop to get notifications on
        both.
      </p>

      {pushEnabled && <TestPushButton />}
      {pushEnabled && (
        <>
          {/* Quieting something for an hour, rather than only on or off. A
              player who cannot do that tends to switch the whole category off
              and never turn it back on — and then the fixture assignments go
              with it. */}
          <div className="mt-4 border-t border-sx-border pt-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-sx-gray">Mute for a while</h3>
            <p className="mt-1 text-xs text-sx-gray">
              Stops the push. These still appear in your notifications bell.
            </p>
            <div className="mt-2 divide-y divide-sx-border">
              {LABELS.map(([key, label]) => (
                <MuteTypeRow key={key} type={key} label={label} mutedUntil={mutedTypes[key] ?? null} />
              ))}
            </div>
          </div>

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

// Sends a push to this device on demand. Diagnosing "push doesn't arrive"
// otherwise needs two accounts, a backgrounded tab, and a guess about which of
// a dozen layers failed. This isolates the last two: "Sent" means every server
// layer worked and FCM accepted it, so if nothing appears the problem is the
// device — most often iOS Safari, where web push only works once the site is
// installed to the Home Screen.
function TestPushButton() {
  const [state, setState] = useState<'idle' | 'sending' | TestPushResult>('idle')

  async function handleTest() {
    setState('sending')
    setState(await sendTestPush())
  }

  const message =
    state === 'idle' || state === 'sending'
      ? null
      : state.ok
        ? '✅ Sent. It should appear within a few seconds — if it does not, the block is on this device, not the server.'
        : state.reason === 'no-device-token'
          ? '⚠ This device is not registered. Disable and enable push above, then try again.'
          : state.reason === 'not-configured'
            ? '⚠ Push is not configured on the server.'
            : state.reason === 'not-logged-in'
              ? '⚠ Please log in again.'
              : '⚠ Could not send. Check the logs for the FCM error code.'

  return (
    <div className="mt-3 border-t border-sx-border pt-3">
      <button
        type="button"
        onClick={handleTest}
        disabled={state === 'sending'}
        className="rounded-lg border border-sx-border px-4 py-2 text-xs font-bold text-sx-purple-text hover:border-sx-purple/50 disabled:opacity-60"
      >
        {state === 'sending' ? 'Sending…' : 'Send a test notification'}
      </button>
      {message && <p className="mt-2 text-xs leading-relaxed text-sx-gray">{message}</p>}
      <p className="mt-2 text-xs leading-relaxed text-sx-gray">
        On iPhone, notifications only work if you add SentinelX to your Home Screen first (Share →
        Add to Home Screen) and open it from there. Safari itself cannot receive them.
      </p>
    </div>
  )
}
