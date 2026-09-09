'use client'
import { useFormState, useFormStatus } from 'react-dom'
import {
  createStage,
  updateStage,
  deleteStage,
  type StageFormState,
} from '@/lib/tournaments/stage-admin-actions'
import type { StagePlanIssue } from '@/lib/tournaments/stage-plan'
import { openStage, type LobbyState } from '@/lib/tournaments/lobby-admin-actions'

export interface StageRow {
  id: string
  seq: number
  name: string
  roundsCount: number
  lobbySize: number
  advanceCount: number
  status: string
  points: { placement: number[]; perKill: number }
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Not started',
  live: 'Running',
  complete: 'Finished',
}

export function StagesEditor({
  tournamentId,
  stages,
  issues,
  defaultPoints,
}: {
  tournamentId: string
  stages: StageRow[]
  issues: StagePlanIssue[]
  defaultPoints: { placement: number[]; perKill: number }
}) {
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  return (
    <div className="space-y-6">
      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-2">
          {errors.map((i, n) => (
            <p
              key={`e${n}`}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            >
              {i.message}
            </p>
          ))}
          {warnings.map((i, n) => (
            <p
              key={`w${n}`}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
            >
              {i.message}
            </p>
          ))}
        </div>
      )}

      {stages.map((stage) => (
        <StageCard key={stage.id} stage={stage} />
      ))}

      <NewStageForm tournamentId={tournamentId} defaultPoints={defaultPoints} />
    </div>
  )
}

function StageCard({ stage }: { stage: StageRow }) {
  const [state, formAction] = useFormState<StageFormState, FormData>(updateStage, undefined)
  const [deleteState, deleteAction] = useFormState<StageFormState, FormData>(deleteStage, undefined)
  // A finished stage governs results that already exist, so its shape is
  // locked. Shown read-only rather than hidden — an admin still needs to see
  // what the rules were.
  const locked = stage.status === 'complete'

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">
          <span className="mr-2 text-slate-500">{stage.seq}.</span>
          {stage.name}
        </h3>
        <span className="text-[11px] uppercase tracking-widest text-slate-500">
          {STATUS_LABEL[stage.status] ?? stage.status}
        </span>
      </div>

      {stage.status === 'pending' && <OpenStageForm stageId={stage.id} />}

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="stageId" value={stage.id} />
        <StageFields
          disabled={locked}
          defaults={{
            name: stage.name,
            roundsCount: String(stage.roundsCount),
            lobbySize: String(stage.lobbySize),
            advanceCount: String(stage.advanceCount),
            placementPoints: stage.points.placement.join(', '),
            perKill: String(stage.points.perKill),
          }}
        />
        {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
        {state?.success && <p className="text-xs text-emerald-400">Saved.</p>}
        {!locked && <SubmitButton label="Save stage" />}
      </form>

      {!locked && (
        <form action={deleteAction} className="mt-3 border-t border-slate-800 pt-3">
          <input type="hidden" name="stageId" value={stage.id} />
          {deleteState?.error && <p className="mb-2 text-xs text-red-400">{deleteState.error}</p>}
          <DeleteButton />
        </form>
      )}
    </div>
  )
}

function OpenStageForm({ stageId }: { stageId: string }) {
  const [state, formAction] = useFormState<LobbyState, FormData>(openStage, undefined)
  return (
    <form action={formAction} className="mb-3 border-b border-slate-800 pb-3">
      <input type="hidden" name="stageId" value={stageId} />
      <p className="mb-2 text-xs text-slate-400">
        Opening this stage draws round 1&apos;s lobbies from the entrants who qualified for it.
      </p>
      {state?.error && <p className="mb-2 text-xs text-red-400">{state.error}</p>}
      <OpenStageButton />
    </form>
  )
}

function OpenStageButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-300 hover:bg-violet-500/20 disabled:opacity-60"
    >
      {pending ? 'Opening…' : 'Open stage & draw round 1'}
    </button>
  )
}

function NewStageForm({
  tournamentId,
  defaultPoints,
}: {
  tournamentId: string
  defaultPoints: { placement: number[]; perKill: number }
}) {
  const [state, formAction] = useFormState<StageFormState, FormData>(createStage, undefined)

  return (
    <form action={formAction} className="rounded-2xl border border-dashed border-slate-700 p-4">
      <h3 className="mb-3 text-sm font-bold text-white">Add a stage</h3>
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <div className="space-y-3">
        <StageFields
          defaults={{
            name: '',
            roundsCount: '3',
            lobbySize: '48',
            advanceCount: '1',
            // Prefilled from the game's own table, so a Free Fire stage starts
            // at the FFWS values rather than an empty box.
            placementPoints: defaultPoints.placement.join(', '),
            perKill: String(defaultPoints.perKill),
          }}
        />
        {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
        {state?.success && <p className="text-xs text-emerald-400">Stage added.</p>}
        <SubmitButton label="Add stage" />
      </div>
    </form>
  )
}

function StageFields({
  defaults,
  disabled = false,
}: {
  defaults: Record<'name' | 'roundsCount' | 'lobbySize' | 'advanceCount' | 'placementPoints' | 'perKill', string>
  disabled?: boolean
}) {
  return (
    <>
      <Field label="Stage name" name="name" defaultValue={defaults.name} disabled={disabled} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Rounds" name="roundsCount" type="number" defaultValue={defaults.roundsCount} disabled={disabled} />
        <Field label="Per lobby" name="lobbySize" type="number" defaultValue={defaults.lobbySize} disabled={disabled} />
        <Field label="Advance" name="advanceCount" type="number" defaultValue={defaults.advanceCount} disabled={disabled} />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-300">Placement points</label>
        <input
          name="placementPoints"
          defaultValue={defaults.placementPoints}
          disabled={disabled}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none disabled:bg-slate-800 disabled:text-slate-400"
        />
        <p className="text-xs text-slate-500">
          Points for 1st, 2nd, 3rd… in order. Anything past the end of the list scores zero.
        </p>
      </div>
      <Field label="Points per kill" name="perKill" type="number" defaultValue={defaults.perKill} disabled={disabled} />
    </>
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
      <label htmlFor={name} className="text-sm font-medium text-slate-300">
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

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-60"
    >
      {pending ? 'Saving…' : label}
    </button>
  )
}

function DeleteButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs font-semibold text-red-400 hover:text-red-300 disabled:opacity-60"
    >
      {pending ? 'Deleting…' : 'Delete stage'}
    </button>
  )
}
