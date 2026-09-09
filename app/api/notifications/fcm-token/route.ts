import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEVICE_TOKEN_COOKIE, DEVICE_TOKEN_MAX_AGE } from '@/lib/notifications/device-cookie'

export async function POST(req: Request) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { token } = (await req.json()) as { token?: string }
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  // Service-role client for THIS write only — the RLS-scoped one above still
  // proves who is calling.
  //
  // FCM issues one registration token per browser install, so a device carries
  // its token across whoever signs in on it. When a second account signs in on
  // a phone that already registered, this upsert conflicts onto a row owned by
  // the first account, and fcm_tokens_owner's USING clause (player_id =
  // auth.uid(), evaluated against the EXISTING row) rejects it:
  //   42501 new row violates row-level security policy (USING expression)
  // The request 500s and that player can never enable push on that device —
  // permanently, because refreshPushToken() retries on every page load and
  // fails identically each time. Seen in production for a player whose older
  // account had registered the same phone.
  //
  // Reassigning the row is the correct outcome: one physical device has one
  // current owner, and the previous owner is no longer reachable at it.
  //
  // Safe despite bypassing RLS: player_id comes from the verified session, never
  // from the request body, so a caller can still only ever claim a token FOR
  // THEMSELVES. Claiming someone else's token requires knowing that token, which
  // is unguessable and unreadable by other players under the SELECT policy.
  const admin = createAdminClient()
  const { error } = await admin
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
