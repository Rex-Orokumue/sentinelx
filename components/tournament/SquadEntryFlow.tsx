'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { createSquad, lookupSquadByCode, type CreateSquadState, type SquadLookupState } from '@/lib/tournaments/squad-actions'
import { squadInviteShareUrl } from '@/lib/tournaments/squad-share'

type Choice = { squadId: string; squadName: string; inviteCode?: string }

export function SquadEntryFlow({
  tournamentId,
  tournamentSlug,
  tournamentTitle,
  squadSize,
  onChosen,
  onSkip,
}: {
  tournamentId: string
  tournamentSlug: string
  tournamentTitle: string
  squadSize: number
  onChosen: (choice: Choice) => void
  onSkip: () => void
}) {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose')

  if (mode === 'choose') {
    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setMode('create')}
            className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-white hover:border-violet-500"
          >
            Create a Squad
          </button>
          <button
            type="button"
            onClick={() => setMode('join')}
            className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-white hover:border-violet-500"
          >
            Join by Code
          </button>
        </div>
        {/* Admin-arranged path (spec §5.2): a player with no squad yet can
            still register — the admin auto-groups every unassigned paid
            registrant into squads of exactly team_size when registration
            closes. */}
        <button
          type="button"
          onClick={onSkip}
          className="block w-full text-center text-xs font-semibold text-slate-400 hover:text-slate-300"
        >
          Don&apos;t have a squad yet? Register now — you&apos;ll be grouped automatically →
        </button>
      </div>
    )
  }

  if (mode === 'create') {
    return (
      <CreateSquadForm
        tournamentId={tournamentId}
        tournamentSlug={tournamentSlug}
        tournamentTitle={tournamentTitle}
        onCreated={onChosen}
        onBack={() => setMode('choose')}
      />
    )
  }

  return <JoinSquadForm tournamentId={tournamentId} squadSize={squadSize} onJoined={onChosen} onBack={() => setMode('choose')} />
}

function CreateSquadForm({
  tournamentId,
  tournamentSlug,
  tournamentTitle,
  onCreated,
  onBack,
}: {
  tournamentId: string
  tournamentSlug: string
  tournamentTitle: string
  onCreated: (choice: Choice) => void
  onBack: () => void
}) {
  const [state, formAction] = useFormState<CreateSquadState, FormData>(createSquad, undefined)
  const [name, setName] = useState('')

  if (state?.squadId && state.inviteCode) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-emerald-400">✓ Squad created — share your invite code:</p>
        <p className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-center text-lg font-bold tracking-widest text-white">
          {state.inviteCode}
        </p>
        <a
          href={squadInviteShareUrl({ tournamentTitle, tournamentSlug, squadName: name, inviteCode: state.inviteCode })}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs font-semibold text-emerald-400 hover:text-emerald-300"
        >
          ↗ Share on WhatsApp
        </a>
        <button
          type="button"
          onClick={() => onCreated({ squadId: state.squadId!, squadName: name, inviteCode: state.inviteCode })}
          className="w-full rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500"
        >
          Continue to registration →
        </button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input
        type="text"
        name="name"
        placeholder="Squad name (2-30 characters)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder:text-slate-500"
        required
      />
      {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-slate-300">
          ← Back
        </button>
        <button type="submit" className="flex-1 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500">
          Create Squad
        </button>
      </div>
    </form>
  )
}

function JoinSquadForm({
  tournamentId,
  squadSize,
  onJoined,
  onBack,
}: {
  tournamentId: string
  squadSize: number
  onJoined: (choice: Choice) => void
  onBack: () => void
}) {
  const [state, formAction] = useFormState<SquadLookupState, FormData>(lookupSquadByCode, undefined)

  if (state?.squad) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-300">
          You&apos;re joining <span className="font-bold text-white">{state.squad.name}</span> —{' '}
          {state.squad.memberCount}/{state.squad.teamSize} joined so far.
        </p>
        <button
          type="button"
          onClick={() => onJoined({ squadId: state.squad!.id, squadName: state.squad!.name })}
          className="w-full rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500"
        >
          Continue to registration →
        </button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="tournamentId" value={tournamentId} />
      <input
        type="text"
        name="code"
        placeholder={`Invite code (${squadSize > 0 ? `${squadSize}-player squad` : 'from your captain'})`}
        maxLength={8}
        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-center text-sm uppercase tracking-widest text-white placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-500"
        required
      />
      {state?.error && <p className="text-center text-sm text-red-400">{state.error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="flex-1 rounded-xl border border-slate-700 px-5 py-2.5 text-sm font-bold text-slate-300">
          ← Back
        </button>
        <button type="submit" className="flex-1 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500">
          Find Squad
        </button>
      </div>
    </form>
  )
}
