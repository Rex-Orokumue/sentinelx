import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { DEVICE_TOKEN_COOKIE, DEVICE_TOKEN_MAX_AGE } from '@/lib/notifications/device-cookie'

export async function POST(req: Request) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { token } = (await req.json()) as { token?: string }
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const { error } = await supabase
    .from('fcm_tokens')
    .upsert({ player_id: user.id, token, last_active: new Date().toISOString() }, { onConflict: 'token' })
  if (error) {
    // Was a bare 500 with no detail, which is how an intermittent failure
    // here stayed invisible — refreshPushToken now runs on every signed-in
    // page load, so a race between two tabs upserting the same token is a
    // real possibility and needs to be identifiable rather than guessed at.
    console.error('[fcm-token] upsert failed', {
      playerId: user.id,
      code: (error as { code?: string }).code,
      message: error.message,
    })
    return NextResponse.json({ error: 'Could not save token' }, { status: 500 })
  }

  // Remember which token belongs to THIS browser, so signOut() — a plain
  // server action with no access to client state — can deregister only this
  // device instead of every device the player owns.
  cookies().set(DEVICE_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DEVICE_TOKEN_MAX_AGE,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { token } = (await req.json().catch(() => ({}))) as { token?: string }
  // Fall back to the device cookie when the caller sends no token. Without
  // this, "Disable" deleted every token the player owned — so turning push off
  // on a phone silently killed it on their laptop too, and a player could
  // never have two devices registered at once. Each device has its own row;
  // only this one should go.
  const deviceToken = token ?? cookies().get(DEVICE_TOKEN_COOKIE)?.value
  const query = supabase.from('fcm_tokens').delete().eq('player_id', user.id)
  if (deviceToken) query.eq('token', deviceToken)
  const { error } = await query
  if (error) return NextResponse.json({ error: 'Could not remove token' }, { status: 500 })

  cookies().delete(DEVICE_TOKEN_COOKIE)
  return NextResponse.json({ ok: true })
}
