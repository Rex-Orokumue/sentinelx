'use client'
import { useFormState, useFormStatus } from 'react-dom'
import {
  generateNextRound,
  updateLobbyDetails,
  type LobbyState,
} from '@/lib/tournaments/lobby-admin-actions'

export interface LobbyView {
  id: string
  roundNo: number
  label: string
  status: string
  entrantCount: number
  roomId: string
  roomPassword: string
  scheduledAt: string
  youtubeStreamUrl: string
}

export interface StageLobbies {
  id: string
  seq: number
  name: string
  status: string
  roundsCount: number
  lobbies: LobbyView[]
}

const LOBBY_STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  awaiting_results: 'Awaiting results',
  confirmed: 'Confirmed',
}

export function LobbyList({ stages }: { stages: StageLobbies[] }) {
  if (stages.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-700 bg-slate-900/40 p-5 text-sm text-slate-400">
        No stages yet. Add them on the Stages page, then open the first one to draw its lobbies.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      {stages.map((stage) => (
        <StageBlock key={stage.id} stage={stage} />
      ))}
    </div>
  )
}

function StageBlock({ stage }: { stage: StageLobbies }) {
  const [state, formAction] = useFormState<LobbyState, FormData>(generateNextRound, undefined)

  const rounds = Array.from(new Set(stage.lobbies.map((l) => l.roundNo))).sort((a, b) => a - b)
  const currentRound = rounds.length > 0 ? rounds[rounds.length - 1] : 0
  const currentRoundLobbies = stage.lobbies.filter((l) => l.roundNo === currentRound)
  const unconfirmed = currentRoundLobbies.filter((l) => l.status !== 'confirmed').length
  const roundsRemaining = currentRound > 0 && currentRound < stage.roundsCount

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">
          <span className="mr-2 text-slate-500">{stage.seq}.</span>
          {stage.name}
        </h3>
        <span className="text-[11px] uppercase tracking-widest text-slate-500">
          {rounds.length} of {stage.roundsCount} round{stage.roundsCount === 1 ? '' : 's'} drawn
        </span>
      </div>

      {stage.lobbies.length === 0 ? (
        <p className="rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
          Not opened yet. Open this stage from the Stages page to draw round 1.
        </p>
      ) : (
        <div className="space-y-5">
          {rounds.map((roundNo) => (
            <div key={roundNo}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
                Round {roundNo}
              </p>
              <div className="space-y-3">
                {stage.lobbies
                  .filter((l) => l.roundNo === roundNo)
                  .map((lobby) => (
                    <LobbyCard key={lobby.id} lobby={lobby} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {roundsRemaining && (
        <form action={formAction} className="mt-4">
          <input type="hidden" name="stageId" value={stage.id} />
          {/* Disabled with a reason rather than hidden, so an admin can see why
              it is unavailable instead of wondering where it went. */}
          {unconfirmed > 0 && (
            <p className="mb-2 text-xs text-amber-300">
              Round {currentRound} has {unconfirmed} lobby/lobbies awaiting confirmation. The next
              round is drawn from the standings, so it cannot be seeded until they are all in.
            </p>
          )}
          {state?.error && <p className="mb-2 text-xs text-red-400">{state.error}</p>}
          <NextRoundButton round={currentRound + 1} disabled={unconfirmed > 0} />
        </form>
      )}
    </div>
  )
}

function LobbyCard({ lobby }: { lobby: LobbyView }) {
  const [state, formAction] = useFormState<LobbyState, FormData>(updateLobbyDetails, undefined)
  const locked = lobby.status === 'confirmed'

  return (
    <form action={formAction} className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
      <input type="hidden" name="lobbyId" value={lobby.id} />
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-bold text-white">
          Lobby {lobby.label}
          <span className="ml-2 text-xs font-normal text-slate-400">
            {lobby.entrantCount} entrant{lobby.entrantCount === 1 ? '' : 's'}
          </span>
        </h4>
        <span className="text-[11px] uppercase tracking-widest text-slate-500">
          {LOBBY_STATUS_LABEL[lobby.status] ?? lobby.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Room ID" name="roomId" defaultValue={lobby.roomId} disabled={locked} />
        <Field label="Room password" name="roomPassword" defaultValue={lobby.roomPassword} disabled={locked} />
        <Field
          label="Scheduled"
          name="scheduledAt"
          type="datetime-local"
          defaultValue={lobby.scheduledAt}
          disabled={locked}
        />
        <Field
          label="Stream URL"
          name="youtubeStreamUrl"
          type="url"
          defaultValue={lobby.youtubeStreamUrl}
          disabled={locked}
        />
      </div>

      {state?.error && <p className="mt-2 text-xs text-red-400">{state.error}</p>}
      {state?.success && <p className="mt-2 text-xs text-emerald-400">Saved.</p>}
      {!locked && (
        <div className="mt-3">
          <SaveButton />
        </div>
      )}
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  disabled,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-xs font-medium text-slate-400">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none disabled:bg-slate-800 disabled:text-slate-400"
      />
    </div>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save lobby'}
    </button>
  )
}

function NextRoundButton({ round, disabled }: { round: number; disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
    >
      {pending ? 'Drawing…' : `Draw round ${round}`}
    </button>
  )
}
