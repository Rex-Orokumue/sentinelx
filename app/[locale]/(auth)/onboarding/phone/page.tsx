import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/i18n/locales'
import { createClient } from '@/lib/supabase/server'
import { OnboardingPhoneClient } from './OnboardingPhoneClient'

export async function generateMetadata({ params }: { params: { locale: Locale } }) {
  const t = await getTranslations({ locale: params.locale, namespace: 'auth.meta' })
  return { title: t('phone'), robots: { index: false, follow: false } }
}

export default async function OnboardingPhonePage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/onboarding/phone')

  const { data: profile } = await supabase
    .from('profiles')
    .select('phone_verified_at')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.phone_verified_at) redirect('/dashboard')

  const t = await getTranslations('auth.phoneStep')

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t('title')}</h1>
      <p className="mb-6 text-sm text-slate-400">{t('subtitle')}</p>
      <OnboardingPhoneClient />
    </div>
  )
}
