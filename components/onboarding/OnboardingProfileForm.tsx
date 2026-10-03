'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { completeProfileOnboarding, type CompleteProfileOnboardingState } from '@/lib/onboarding/actions'
import { listCountries } from '@/lib/phone/number'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'Please fill in every field and pick at least one game.',
  invalid_country: 'Select a country from the list.',
  invalid_whatsapp: 'Enter a valid WhatsApp number for the selected country.',
  unknown_game: 'One of the games you picked is no longer available. Reload and try again.',
  save_failed: 'Could not save your profile. Please try again.',
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Saving…' : 'Continue'}
    </Button>
  )
}

export function OnboardingProfileForm({
  games,
  selectedGameIds,
  next,
}: {
  games: { id: string; name: string; icon_url: string | null }[]
  selectedGameIds: string[]
  next?: string
}) {
  const [state, formAction] = useFormState<CompleteProfileOnboardingState, FormData>(completeProfileOnboarding, undefined)
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedGameIds))
  const [consent, setConsent] = useState(false)
  const countries = listCountries()

  function toggleGame(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <form action={formAction} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="space-y-1.5">
        <Label htmlFor="country">Country</Label>
        <select
          id="country"
          name="country"
          defaultValue=""
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="" disabled>
            Select your country
          </option>
          {countries.map((c) => (
            <option key={c.code} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="whatsapp">WhatsApp number</Label>
        <Input id="whatsapp" name="whatsapp" type="tel" placeholder="+2348012345678" required autoFocus />
      </div>

      <div className="space-y-1.5">
        <Label>Which games are you interested in?</Label>
        <div className="space-y-1.5 rounded-lg border border-slate-700 bg-slate-950 p-3">
          {games.map((game) => (
            <label key={game.id} className="flex items-center gap-2 text-sm text-white">
              <input
                type="checkbox"
                name="gameInterests"
                value={game.id}
                checked={selected.has(game.id)}
                onChange={() => toggleGame(game.id)}
                className="h-4 w-4 accent-violet-500"
              />
              {game.name}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-violet-500"
        />
        I agree to receive tournament updates on WhatsApp
      </label>
      {/* A bare unchecked checkbox omits itself from FormData — mirror the
          controlled state into a hidden input so "no" always arrives as the
          literal string 'false', distinguishable from "never answered". */}
      <input type="hidden" name="consentWhatsappUpdates" value={consent ? 'true' : 'false'} />

      {state?.errorCode && <p className="text-sm text-red-400">{ERROR_MESSAGES[state.errorCode]}</p>}
      <SubmitButton />
    </form>
  )
}
