import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/i18n/locales'
import { createClient } from '@/lib/supabase/server'
import { safeInternalPath } from '@/lib/onboarding/safe-path'
import { OnboardingProfileForm } from '@/components/onboarding/OnboardingProfileForm'

export async function generateMetadata({ params }: { params: { locale: Locale } }) {
  const t = await getTranslations({ locale: params.locale, namespace: 'auth.meta' })
  return { title: t('profile'), robots: { index: false, follow: false } }
}

export default async function OnboardingProfilePage({
  searchParams,
}: {
  searchParams: { next?: string }
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/profile')

  const { data: profile } = await supabase
    .from('profiles')
    .select('profile_completed_at')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.profile_completed_at) redirect(safeInternalPath(searchParams.next, '/dashboard'))

  const [{ data: games }, { data: existingInterest }] = await Promise.all([
    supabase.from('games').select('id, name, icon_url').order('name'),
    supabase.from('game_interest').select('game_id').eq('user_id', user.id),
  ])

  const t = await getTranslations('auth.profileStep')
  const next = safeInternalPath(searchParams.next, '')

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t('title')}</h1>
      <p className="mb-6 text-sm text-slate-400">{t('subtitle')}</p>
      <OnboardingProfileForm
        games={games ?? []}
        selectedGameIds={(existingInterest ?? []).map((row) => row.game_id)}
        next={next || undefined}
      />
    </div>
  )
}
