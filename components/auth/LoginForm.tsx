'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { login, resendConfirmation, type ActionState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GoogleSignInButton } from './GoogleSignInButton'

function SubmitButton() {
  const t = useTranslations('auth.login')
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? t('submitting') : t('submit')}
    </Button>
  )
}

function ResendButton() {
  const t = useTranslations('auth.login')
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="font-semibold text-violet-400 hover:text-violet-300 disabled:opacity-60"
    >
      {pending ? t('resending') : t('resend')}
    </button>
  )
}

export function LoginForm() {
  const t = useTranslations('auth')
  const [state, formAction] = useFormState<ActionState, FormData>(login, undefined)
  const [resendState, resendAction] = useFormState<ActionState, FormData>(resendConfirmation, undefined)
  const [email, setEmail] = useState('')
  const next = useSearchParams().get('next') ?? '/dashboard'

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('common.email')}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('common.password')}</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state?.errorCode && <p className="text-sm text-red-400">{t(`errors.${state.errorCode}`)}</p>}
        <SubmitButton />
      </form>

      {state?.needsConfirmation && !resendState?.noticeCode && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-300">
          <form action={resendAction}>
            <input type="hidden" name="email" value={email} />
            <ResendButton />
          </form>
          <p className="mt-1 text-xs text-slate-500">{t('login.resendHint')}</p>
        </div>
      )}
      {resendState?.noticeCode && (
        <p className="text-sm text-emerald-400">{t(`notices.${resendState.noticeCode}`)}</p>
      )}
      {resendState?.errorCode && (
        <p className="text-sm text-red-400">{t(`errors.${resendState.errorCode}`)}</p>
      )}

      <div className="flex justify-between text-sm text-slate-400">
        <Link href="/forgot-password" className="hover:text-white">{t('login.forgot')}</Link>
        <Link href="/signup" className="hover:text-white">{t('login.createAccount')}</Link>
      </div>
      <div className="flex items-center gap-3 py-2">
        <div className="h-px flex-1 bg-slate-800" />
        <span className="text-xs text-slate-500">{t('common.or')}</span>
        <div className="h-px flex-1 bg-slate-800" />
      </div>
      <GoogleSignInButton next={next} />
    </div>
  )
}
