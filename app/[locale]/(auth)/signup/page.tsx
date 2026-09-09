import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/i18n/locales'
import { SignupWizard } from '@/components/auth/SignupWizard'

export async function generateMetadata({ params }: { params: { locale: Locale } }) {
  const t = await getTranslations({ locale: params.locale, namespace: 'auth.meta' })
  return { title: t('signup'), robots: { index: false, follow: false } }
}

export default function SignupPage({ searchParams }: { searchParams: { ref?: string } }) {
  return <SignupWizard refCode={searchParams.ref ?? null} />
}
