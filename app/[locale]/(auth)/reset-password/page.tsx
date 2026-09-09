import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/i18n/locales'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'

export async function generateMetadata({ params }: { params: { locale: Locale } }) {
  const t = await getTranslations({ locale: params.locale, namespace: 'auth.meta' })
  return { title: t('resetPassword'), robots: { index: false, follow: false } }
}

export default async function ResetPasswordPage() {
  const t = await getTranslations('auth.reset')
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t('title')}</h1>
      <p className="mb-6 text-sm text-slate-400">{t('subtitle')}</p>
      <ResetPasswordForm />
    </div>
  )
}
