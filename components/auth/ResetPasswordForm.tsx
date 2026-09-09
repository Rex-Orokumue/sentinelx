'use client'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { resetPassword, type ActionState } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton() {
  const t = useTranslations('auth.reset')
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? t('submitting') : t('submit')}
    </Button>
  )
}

export function ResetPasswordForm() {
  const t = useTranslations('auth')
  const [state, formAction] = useFormState<ActionState, FormData>(resetPassword, undefined)
  const [show, setShow] = useState(false)
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">{t('reset.newPassword')}</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-label={show ? t('common.hidePassword') : t('common.showPassword')}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-slate-500">{t('common.atLeast8')}</p>
      </div>
      {state?.errorCode && <p className="text-sm text-red-400">{t(`errors.${state.errorCode}`)}</p>}
      <SubmitButton />
    </form>
  )
}
