import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import type { Locale } from '@/i18n/locales'
import { LoginForm } from '@/components/auth/LoginForm'

export async function generateMetadata({ params }: { params: { locale: Locale } }) {
  const t = await getTranslations({ locale: params.locale, namespace: 'auth.meta' })
  return { title: t('login'), robots: { index: false, follow: false } }
}

export default async function LoginPage() {
  const t = await getTranslations('auth.login')
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t('title')}</h1>
      <p className="mb-6 text-sm text-slate-400">{t('subtitle')}</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}
