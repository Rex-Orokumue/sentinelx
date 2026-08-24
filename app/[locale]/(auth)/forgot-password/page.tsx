import type { Metadata } from 'next'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'

export const metadata: Metadata = { title: 'Forgot password · SentinelX Esports' }

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Reset your password</h1>
      <p className="mb-6 text-sm text-slate-400">Enter your email and we'll send a reset link.</p>
      <ForgotPasswordForm />
    </div>
  )
}
