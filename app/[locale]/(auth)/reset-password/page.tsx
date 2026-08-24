import type { Metadata } from 'next'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'

export const metadata: Metadata = { title: 'Set new password · SentinelX Esports' }

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Set a new password</h1>
      <p className="mb-6 text-sm text-slate-400">Choose a new password for your account.</p>
      <ResetPasswordForm />
    </div>
  )
}
