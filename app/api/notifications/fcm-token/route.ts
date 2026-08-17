import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
  if (error) return NextResponse.json({ error: 'Could not save token' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { token } = (await req.json().catch(() => ({}))) as { token?: string }
  const query = supabase.from('fcm_tokens').delete().eq('player_id', user.id)
  if (token) query.eq('token', token)
  const { error } = await query
  if (error) return NextResponse.json({ error: 'Could not remove token' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
