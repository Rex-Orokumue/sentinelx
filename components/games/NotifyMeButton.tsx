'use client'
import { useEffect, useState } from 'react'
import { Bell, BellRing } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const LOCAL_KEY = 'sx-game-interest'

function readLocal(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]')
  } catch {
    return []
  }
}
function writeLocal(ids: string[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(ids))
}

// "Notify Me" on a Coming Soon game card (spec §6). Logged-in players write a
// real row to `game_interest`; logged-out visitors get a localStorage flag —
// either way the click has to actually record something, not just look pressed.
export function NotifyMeButton({ gameId }: { gameId: string }) {
  const [interested, setInterested] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function init() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (!cancelled) setInterested(readLocal().includes(gameId))
        return
      }
      const { data } = await supabase
        .from('game_interest')
        .select('game_id')
        .eq('user_id', user.id)
        .eq('game_id', gameId)
        .maybeSingle()
      if (!cancelled) setInterested(!!data)
    }
    init()
    return () => {
      cancelled = true
    }
  }, [gameId])

  async function toggle() {
    setPending(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      const ids = readLocal()
      const next = interested ? ids.filter((id) => id !== gameId) : [...ids, gameId]
      writeLocal(next)
      setInterested(!interested)
      setPending(false)
      return
    }

    if (interested) {
      await supabase.from('game_interest').delete().eq('user_id', user.id).eq('game_id', gameId)
    } else {
      await supabase.from('game_interest').insert({ user_id: user.id, game_id: gameId })
    }
    setInterested(!interested)
    setPending(false)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors disabled:opacity-60 ${
        interested
          ? 'border-sx-purple/40 bg-sx-purple/10 text-sx-purple-text'
          : 'border-sx-border text-white hover:border-sx-purple/40'
      }`}
    >
      {interested ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
      {interested ? "You're on the list" : 'Notify Me'}
    </button>
  )
}
