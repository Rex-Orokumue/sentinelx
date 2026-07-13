'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import { payStake, type PayStakeState } from '@/lib/friendly-matches/pay-actions'
import { submitFriendlyResult } from '@/lib/friendly-matches/result-actions'
import type { FriendlyActionState } from '@/lib/friendly-matches/actions'
import { createClient } from '@/lib/supabase/client'

export function MatchRoom({
  matchId,
  status,
  stakeAmount,
  isChallenger,
  challengerPaid,
  opponentPaid,
  gameCode,
  opponentWhatsappUrl,
  scoreChallenger,
  scoreOpponent,
}: {
  matchId: string
  status: string
  stakeAmount: number | null
  isChallenger: boolean
  challengerPaid: boolean
  opponentPaid: boolean
  gameCode: string | null
  opponentWhatsappUrl: string | null
  scoreChallenger: number | null
  scoreOpponent: number | null
}) {
  const myPaid = isChallenger ? challengerPaid : opponentPaid
  const [payState, payAction] = useFormState<PayStakeState, FormData>(payStake, undefined)

  if (status === 'awaiting_payment') {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-center">
        <p className="mb-3 text-sm text-slate-300">
          Both players must pay ₦{stakeAmount} to unlock the Match Room.
        </p>
        {myPaid ? (
          <p className="text-sm font-semibold text-emerald-400">You&apos;ve paid — waiting on your opponent.</p>
        ) : (
          <form action={payAction}>
            <input type="hidden" name="id" value={matchId} />
            <button type="submit" className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500">
              Pay ₦{stakeAmount}
            </button>
            {payState?.error && <p className="mt-2 text-xs text-red-400">{payState.error}</p>}
          </form>
        )}
      </div>
    )
  }

  if (status === 'active') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          {opponentWhatsappUrl ? (
            <a
              href={opponentWhatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#25D366]/30 px-3 py-1.5 text-xs font-bold text-[#25D366] hover:bg-[#25D366]/10"
            >
              Coordinate on WhatsApp
            </a>
          ) : (
            <p className="text-xs text-slate-500">Your opponent hasn&apos;t added a WhatsApp number yet.</p>
          )}
          <GameCodeField matchId={matchId} isChallenger={isChallenger} initialCode={gameCode} />
        </div>
        <ResultForm matchId={matchId} />
      </div>
    )
  }

  if (status === 'awaiting_admin_confirmation') {
    return (
      <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm text-amber-300">
        Result submitted — waiting on admin confirmation.
      </p>
    )
  }

  if (status === 'completed') {
    return (
      <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center text-sm text-emerald-300">
        Match confirmed: {scoreChallenger}–{scoreOpponent}.
      </p>
    )
  }

  return <p className="text-sm text-slate-500">This match is {status}.</p>
}

function GameCodeField({
  matchId,
  isChallenger,
  initialCode,
}: {
  matchId: string
  isChallenger: boolean
  initialCode: string | null
}) {
  const [code, setCode] = useState(initialCode ?? '')
  const [saving, setSaving] = useState(false)

  if (!isChallenger) {
    return (
      <p className="mt-3 text-sm text-slate-300">
        Game code: <span className="font-bold text-white">{code || 'not set yet'}</span>
      </p>
    )
  }

  async function save() {
    setSaving(true)
    const supabase = createClient()
    await supabase.from('friendly_matches').update({ game_code: code }).eq('id', matchId)
    setSaving(false)
  }

  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Drop your in-game code"
        className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        Save
      </button>
    </div>
  )
}

function ResultForm({ matchId }: { matchId: string }) {
  const [state, action] = useFormState<FriendlyActionState, FormData>(submitFriendlyResult, undefined)
  const [uploading, setUploading] = useState(false)
  const [screenshotUrl, setScreenshotUrl] = useState('')

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setUploading(false)
      return
    }
    const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '')
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('friendly-match-evidence').upload(path, file)
    if (!error) {
      const { data } = supabase.storage.from('friendly-match-evidence').getPublicUrl(path)
      setScreenshotUrl(data.publicUrl)
    }
    setUploading(false)
  }

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <input type="hidden" name="id" value={matchId} />
      <input type="hidden" name="screenshotUrl" value={screenshotUrl} />
      <p className="text-sm font-bold text-white">Submit the result</p>
      <div className="flex gap-3">
        <input name="scoreChallenger" type="number" min={0} placeholder="Your score" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
        <input name="scoreOpponent" type="number" min={0} placeholder="Opponent score" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none" />
      </div>
      <input type="file" accept="image/*" onChange={onFile} className="text-xs text-slate-400" />
      {uploading && <p className="text-xs text-slate-500">Uploading…</p>}
      {state?.error && <p className="text-xs text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={uploading || !screenshotUrl}
        className="w-full rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        Submit result
      </button>
    </form>
  )
}
