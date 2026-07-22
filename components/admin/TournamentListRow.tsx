'use client'
import Link from 'next/link'
import { useFormState } from 'react-dom'
import {
  deleteTournament,
  openRegistration,
  type TournamentFormState,
  type PublishState,
} from '@/lib/tournaments/admin-actions'
import { CancelTournamentButton } from './CancelTournamentButton'

export interface AdminTournamentRow {
  id: string
  title: string
  slug: string
  status: string
  gameName: string | null
  publishBlockers: string[] // from missingForPublish; only meaningful when status === 'draft'
  paidRegistrations: number
}

const STATUS: Record<string, string> = {
  draft: 'text-slate-400',
  registration_open: 'text-emerald-400',
  registration_closed: 'text-amber-400',
  active: 'text-violet-400',
  completed: 'text-blue-400',
}

export function TournamentListRow({ t, isAdmin }: { t: AdminTournamentRow; isAdmin: boolean }) {
  const [openState, openAction] = useFormState<PublishState, FormData>(openRegistration, undefined)
  const [delState, delAction] = useFormState<TournamentFormState, FormData>(
    deleteTournament,
    undefined,
  )
  const isDraft = t.status === 'draft'
  const canPublish = isDraft && t.publishBlockers.length === 0
  const canCancel = isAdmin && ['registration_open', 'registration_closed', 'active'].includes(t.status)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate font-bold text-white">{t.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {t.gameName ?? 'No game'} ·{' '}
            <span className={STATUS[t.status] ?? 'text-slate-400'}>
              {t.status.replace(/_/g, ' ')}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/admin/tournaments/${t.id}/edit`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Edit
          </Link>
          <Link
            href={`/admin/tournaments/${t.id}/registrations`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Registrations
          </Link>
          <Link
            href={`/admin/tournaments/${t.id}/bracket`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Bracket
          </Link>
          <Link
            href={`/admin/tournaments/${t.id}/matches`}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-500"
          >
            Matches
          </Link>
          {isDraft && (
            <form action={openAction}>
              <input type="hidden" name="id" value={t.id} />
              <button
                type="submit"
                disabled={!canPublish}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-40"
              >
                Open registration
              </button>
            </form>
          )}
          {isDraft && isAdmin && (
            <form action={delAction}>
              <input type="hidden" name="id" value={t.id} />
              <button
                type="submit"
                className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500/10"
              >
                Delete
              </button>
            </form>
          )}
          {canCancel && (
            <CancelTournamentButton id={t.id} title={t.title} paidRegistrations={t.paidRegistrations} />
          )}
        </div>
      </div>

      {isDraft && t.publishBlockers.length > 0 && (
        <p className="mt-2 text-xs text-amber-400/80">
          To open registration, add: {t.publishBlockers.join(', ')}.
        </p>
      )}
      {openState?.fieldErrors && (
        <p className="mt-2 text-xs text-amber-400/80">
          Missing: {openState.fieldErrors.join(', ')}.
        </p>
      )}
      {openState?.error && <p className="mt-2 text-xs text-red-400">{openState.error}</p>}
      {delState?.error && <p className="mt-2 text-xs text-red-400">{delState.error}</p>}
    </div>
  )
}
