import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/i18n/locales'
import { createClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/onboarding/safe-path'
import { ClaimUsernameForm } from '@/components/onboarding/ClaimUsernameForm'

export async function generateMetadata({ params }: { params: { locale: Locale } }) {
  const t = await getTranslations({ locale: params.locale, namespace: 'auth.meta' })
  return { title: t('username'), robots: { index: false, follow: false } }
}

export default async function ClaimUsernamePage({
  searchParams,
}: {
  searchParams: { next?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/username')

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.username) redirect(safeInternalPath(searchParams.next, '/dashboard'))

  // Email signups carry the handle picked in the wizard as signup metadata
  // (see migration 073) — pre-fill it so the common case is a single tap.
  const desired = user.user_metadata?.username
  const defaultUsername = typeof desired === 'string' ? desired : ''
  const next = safeInternalPath(searchParams.next, '')
  const t = await getTranslations('auth.usernameStep')

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t('title')}</h1>
      <p className="mb-6 text-sm text-slate-400">{t('subtitle')}</p>
      <ClaimUsernameForm defaultUsername={defaultUsername} next={next || undefined} />
    </div>
  )
}
