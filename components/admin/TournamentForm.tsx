'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { type TournamentFormState } from '@/lib/tournaments/admin-actions'
import { TournamentCardImageField } from './TournamentCardImageField'
import { formatsForGame, FORMAT_LABEL, type CompetitionFormat } from '@/lib/tournaments/formats'
import {
  formatsForMode,
  mapsForMode,
  resolveModeSelection,
  MATCH_RULES_LABEL,
} from '@/lib/tournaments/mode-selection'
import type { ModeCatalogue } from '@/lib/tournaments/mode-catalogue'

export interface TournamentFormValues {
  id?: string
  title: string
  slug: string
  gameId: string
  description: string
  bannerUrl: string
  cardImageUrl: string
  registrationFee: string
  prizePool: string
  maxPlayers: string
  registrationStart: string
  registrationEnd: string
  tournamentStart: string
  tournamentEnd: string
  rules: string
  dataSupportText: string
  dataSupportWhatsapp: string
  tournamentType: string
  seasonId: string
  format: string
  manualKnockoutPairing: boolean
  prizeSecond: string
  prizeThird: string
  competitionFormat: string
  entryUnit: string
  squadSize: string
  modeId: string
  formatId: string
  defaultMapId: string
  matchRules: string
  matchType: string
}

type Action = (prev: TournamentFormState, fd: FormData) => Promise<TournamentFormState>

export function TournamentForm({
  action,
  games,
  seasons,
  catalogue,
  initial,
  slugLocked,
  submitLabel,
}: {
  action: Action
  games: { id: string; name: string; supportedFormats: string[] }[]
  seasons: { id: string; name: string }[]
  catalogue: ModeCatalogue
  initial: TournamentFormValues
  slugLocked: boolean
  submitLabel: string
}) {
  const [state, formAction] = useFormState<TournamentFormState, FormData>(action, undefined)
  const [tournamentType, setTournamentType] = useState(initial.tournamentType || 'open')
  const [gameId, setGameId] = useState(initial.gameId)
  const [competitionFormat, setCompetitionFormat] = useState(initial.competitionFormat || 'head_to_head')
  const [entryUnit, setEntryUnit] = useState(initial.entryUnit || 'solo')

  const [modeId, setModeId] = useState(initial.modeId)
  const [formatId, setFormatId] = useState(initial.formatId)
  const [mapId, setMapId] = useState(initial.defaultMapId)

  // Only the formats the chosen game declares. Falls back to head-to-head
  // when no game is picked yet, so the control is never empty.
  const availableFormats = formatsForGame(games.find((g) => g.id === gameId)?.supportedFormats)

  // Modes belong to a game. A game with none keeps the existing Competition
  // Format picker and every mode field stays empty.
  const gameModes = catalogue.modes.filter((m) => m.gameId === gameId)
  const hasModes = gameModes.length > 0
  const selectedMode = gameModes.find((m) => m.id === modeId) ?? null
  const modeFormats = formatsForMode(catalogue.formats, modeId || null)
  const modeMaps = mapsForMode(catalogue.maps, modeId || null)
  const selectedFormat = modeFormats.find((f) => f.id === formatId) ?? null
  const derived = resolveModeSelection(selectedMode, selectedFormat)

  // Changing Mode must clear Format and Map, or a stale Clash Squad map
  // survives onto a Battle Royale tournament — the exact bug the mock had.
  function onModeChange(nextModeId: string) {
    setModeId(nextModeId)
    setFormatId('')
    setMapId('')
  }

  const isPointsRace = hasModes
    ? derived.competitionFormat === 'points_race'
    : competitionFormat === 'points_race'
  const isInvitationOnly = tournamentType === 'masters' || tournamentType === 'champions_cup'
  return (
    <form action={formAction} className="space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <Field label="Title" name="title" defaultValue={initial.title} required />

      <div className="space-y-1.5">
        <label htmlFor="slug" className="text-sm font-medium text-slate-300">
          URL slug {slugLocked && <span className="text-slate-500">— locked</span>}
        </label>
        <input
          id="slug"
          name="slug"
          defaultValue={initial.slug}
          readOnly={slugLocked}
          placeholder="auto-generated from title if left blank"
          className={`w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none ${
            slugLocked ? 'bg-slate-800 text-slate-400' : 'bg-slate-950'
          }`}
        />
        {slugLocked && (
          <p className="text-xs text-slate-500">Locked — changing would break public URLs.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="gameId" className="text-sm font-medium text-slate-300">
          Game
        </label>
        <select
          id="gameId"
          name="gameId"
          value={gameId}
          onChange={(e) => {
            const next = e.target.value
            setGameId(next)
            // A game that cannot run the selected format must not leave the
            // form in a state the database will reject on submit.
            const allowed = formatsForGame(games.find((g) => g.id === next)?.supportedFormats)
            if (!allowed.includes(competitionFormat as CompetitionFormat)) {
              setCompetitionFormat('head_to_head')
              setEntryUnit('solo')
            }
            // Modes belong to ONE game, so every mode-derived choice is stale
            // the moment the game changes.
            onModeChange('')
          }}
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="" disabled>
            Choose a game
          </option>
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      {!hasModes && availableFormats.length > 1 && (
        <div className="space-y-1.5">
          <label htmlFor="competitionFormat" className="text-sm font-medium text-slate-300">
            Competition format
          </label>
          <select
            id="competitionFormat"
            name="competitionFormat"
            value={competitionFormat}
            onChange={(e) => {
              setCompetitionFormat(e.target.value)
              // Squads exist only for points races.
              if (e.target.value !== 'points_race') setEntryUnit('solo')
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          >
            {availableFormats.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* Always submitted, even when the picker is hidden for a single-format
          game, so the action always receives a value. */}
      {!hasModes && availableFormats.length <= 1 && (
        <input type="hidden" name="competitionFormat" value={competitionFormat} />
      )}

      {!hasModes && isPointsRace && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="entryUnit" className="text-sm font-medium text-slate-300">
              Entry unit
            </label>
            <select
              id="entryUnit"
              name="entryUnit"
              value={entryUnit}
              onChange={(e) => setEntryUnit(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="solo">Solo — each player enters alone</option>
              <option value="squad">Squad — players enter as a team</option>
            </select>
          </div>
          {entryUnit === 'squad' && (
            <Field
              label="Players per squad (2–6)"
              name="squadSize"
              type="number"
              defaultValue={initial.squadSize}
            />
          )}
          <p className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-300">
            Points race: entrants play in lobbies scored on placement and kills. Set up its stages
            from the tournament&apos;s Stages page after saving.
          </p>
        </>
      )}
      {!hasModes && !isPointsRace && <input type="hidden" name="entryUnit" value="solo" />}

      {hasModes && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="modeId" className="text-sm font-medium text-slate-300">Mode</label>
            <select
              id="modeId"
              name="modeId"
              value={modeId}
              onChange={(e) => onModeChange(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="">Choose a mode</option>
              {gameModes.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {modeFormats.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="formatId" className="text-sm font-medium text-slate-300">Format</label>
              <select
                id="formatId"
                name="formatId"
                value={formatId}
                onChange={(e) => setFormatId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="">Choose a format</option>
                {modeFormats.map((f) => (
                  // Unavailable formats stay VISIBLE but disabled — the roadmap
                  // is legible, and nobody can create a tournament the platform
                  // cannot finish.
                  <option key={f.id} value={f.id} disabled={!f.available}>
                    {f.name}{f.available ? '' : ' — coming soon'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {modeMaps.length === 1 ? (
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-slate-300">Map</span>
              <p className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300">
                {modeMaps[0].name}
              </p>
              <input type="hidden" name="defaultMapId" value={modeMaps[0].id} />
            </div>
          ) : modeMaps.length > 1 ? (
            <div className="space-y-1.5">
              <label htmlFor="defaultMapId" className="text-sm font-medium text-slate-300">Map</label>
              <select
                id="defaultMapId"
                name="defaultMapId"
                value={mapId}
                onChange={(e) => setMapId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="">Choose a map</option>
                {modeMaps.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">The default. Each lobby can override it.</p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="matchRules" className="text-sm font-medium text-slate-300">Match rules</label>
            <select
              id="matchRules"
              name="matchRules"
              defaultValue={initial.matchRules || 'normal'}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              {Object.entries(MATCH_RULES_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Battle Royale expresses length as a stage's rounds_count, so it
              has no series length at all. */}
          {selectedMode?.competitionFormat === 'head_to_head' && (
            <div className="space-y-1.5">
              <label htmlFor="matchType" className="text-sm font-medium text-slate-300">Match type</label>
              <select
                id="matchType"
                name="matchType"
                defaultValue={initial.matchType || 'bo1'}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
              >
                {catalogue.matchTypes.map((t) => (
                  <option key={t.slug} value={t.slug} disabled={!t.available}>
                    {t.name}{t.available ? '' : ' — coming soon'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Derived, never asked twice — see mode-selection.ts. */}
          <input type="hidden" name="competitionFormat" value={derived.competitionFormat} />
          <input type="hidden" name="entryUnit" value={derived.entryUnit} />
          <input type="hidden" name="squadSize" value={String(derived.squadSize)} />
        </>
      )}

      <div className="space-y-1.5">
        <label htmlFor="tournamentType" className="text-sm font-medium text-slate-300">
          Tournament Type
        </label>
        <select
          id="tournamentType"
          name="tournamentType"
          value={tournamentType}
          onChange={(e) => setTournamentType(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        >
          <option value="open">Open</option>
          <option value="community_club">Community Club</option>
          <option value="masters">SentinelX Masters</option>
          <option value="champions_cup">SentinelX Champions Cup</option>
        </select>
      </div>

      {tournamentType !== 'open' && (
        <div className="space-y-1.5">
          <label htmlFor="seasonId" className="text-sm font-medium text-slate-300">
            Season
          </label>
          <select
            id="seasonId"
            name="seasonId"
            defaultValue={initial.seasonId}
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
          >
            <option value="" disabled>
              Choose a season
            </option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Head-to-head only. Groups, brackets and knockout pairing are
          meaningless for a points race, which runs lobbies instead. Hidden
          rather than disabled so they submit nothing and the schema's defaults
          apply — see the regression test in admin-schema.test.ts. */}
      {!isPointsRace && (
        <>
          <div className="space-y-1.5">
            <label htmlFor="format" className="text-sm font-medium text-slate-300">
              Format
            </label>
            <select
              id="format"
              name="format"
              defaultValue={initial.format || 'group_knockout'}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="group_knockout">Groups + Knockout</option>
              <option value="round_robin">Round Robin (table only, no bracket)</option>
            </select>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              name="manualKnockoutPairing"
              value="true"
              defaultChecked={initial.manualKnockoutPairing}
              className="mt-0.5 accent-violet-600"
            />
            <span>
              Arrange knockout pairings manually
              <span className="mt-0.5 block text-xs text-slate-500">
                Completed rounds won&apos;t auto-generate the next round — you&apos;ll arrange each
                round&apos;s fixtures on the bracket page before players are notified.
              </span>
            </span>
          </label>
        </>
      )}

      {isInvitationOnly && (
        <p className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-300">
          Invitation-only — players can only join via an accepted invitation, not the public registration
          form.
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor="description" className="text-sm font-medium text-slate-300">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          defaultValue={initial.description}
          rows={3}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="rules" className="text-sm font-medium text-slate-300">
          Rules
        </label>
        <textarea
          id="rules"
          name="rules"
          defaultValue={initial.rules}
          rows={8}
          placeholder={'Markdown supported: **bold**, - lists, [links](https://...)'}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        <p className="text-xs text-slate-500">
          Shown to players above the register button. Leave blank to skip the rules step entirely.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="dataSupportText" className="text-sm font-medium text-slate-300">
          Data support perk <span className="text-slate-500">(optional)</span>
        </label>
        <textarea
          id="dataSupportText"
          name="dataSupportText"
          defaultValue={initial.dataSupportText}
          rows={2}
          placeholder="e.g. 1GB data for semi-finalists, 2GB for finalists"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
      </div>

      <Field
        label="Data support WhatsApp number"
        name="dataSupportWhatsapp"
        defaultValue={initial.dataSupportWhatsapp}
      />

      <TournamentCardImageField initialUrl={initial.cardImageUrl} />

      <Field label="Banner URL" name="bannerUrl" type="url" defaultValue={initial.bannerUrl} />

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Registration fee (₦)"
          name="registrationFee"
          type="number"
          defaultValue={initial.registrationFee}
        />
        <Field
          label="Prize pool (₦)"
          name="prizePool"
          type="number"
          defaultValue={initial.prizePool}
        />
        <Field
          label="2nd place prize (₦, optional)"
          name="prizeSecond"
          type="number"
          defaultValue={initial.prizeSecond}
        />
        <Field
          label="3rd place prize (₦, optional)"
          name="prizeThird"
          type="number"
          defaultValue={initial.prizeThird}
        />
      </div>
      <p className="text-xs text-slate-500">
        Leave 2nd/3rd blank for winner-take-all (1st gets the full prize pool). Set both to split
        the pool — 1st automatically gets prize pool minus 2nd and 3rd.
      </p>

      <Field
        label={isPointsRace ? 'Max players (2–200)' : 'Max players (2–64)'}
        name="maxPlayers"
        type="number"
        defaultValue={initial.maxPlayers}
      />

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Registration start"
          name="registrationStart"
          type="datetime-local"
          defaultValue={initial.registrationStart}
        />
        <Field
          label="Registration end"
          name="registrationEnd"
          type="datetime-local"
          defaultValue={initial.registrationEnd}
        />
        <Field
          label="Tournament start"
          name="tournamentStart"
          type="datetime-local"
          defaultValue={initial.tournamentStart}
        />
        <Field
          label="Tournament end"
          name="tournamentEnd"
          type="datetime-local"
          defaultValue={initial.tournamentEnd}
        />
      </div>

      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-400">Saved.</p>}
      <SubmitButton label={submitLabel} />
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium text-slate-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-violet-600 px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Saving…' : label}
    </button>
  )
}
