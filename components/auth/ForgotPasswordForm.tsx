'use client'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { requestReset, type ActionState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton() {
  const t = useTranslations('auth.forgot')
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? t('submitting') : t('submit')}
    </Button>
  )
}

export function ForgotPasswordForm() {
  const t = useTranslations('auth')
  const [state, formAction] = useFormState<ActionState, FormData>(requestReset, undefined)
  if (state?.noticeCode) {
    return (
      <div>
        <p className="text-sm text-slate-300">{t(`notices.${state.noticeCode}`)}</p>
        <p className="mt-4 text-center text-sm text-slate-400">
          <Link href="/login" className="hover:text-white">{t('common.backToLogin')}</Link>
        </p>
      </div>
    )
  }
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">{t('common.email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state?.errorCode && <p className="text-sm text-red-400">{t(`errors.${state.errorCode}`)}</p>}
      <SubmitButton />
      <p className="text-center text-sm text-slate-400">
        <Link href="/login" className="hover:text-white">{t('common.backToLogin')}</Link>
      </p>
    </form>
  )
}
