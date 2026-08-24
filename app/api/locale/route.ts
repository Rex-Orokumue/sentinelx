import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { LOCALES } from '@/i18n/locales'

export async function POST(req: Request) {
  const { locale } = (await req.json()) as { locale?: string }
  if (!locale || !LOCALES.includes(locale as (typeof LOCALES)[number])) {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await supabase.from('profiles').update({ locale }).eq('id', user.id)
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('NEXT_LOCALE', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  return res
}
