import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSupportedLocale, performSetLocale } from '@/lib/profile/locale-service'

export async function POST(req: Request) {
  const { locale } = (await req.json()) as { locale?: string }
  if (!isSupportedLocale(locale)) {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await performSetLocale(createAdminClient(), user.id, locale)
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('NEXT_LOCALE', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  return res
}
