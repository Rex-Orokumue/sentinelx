import { Suspense } from 'react'
import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/LoginForm'

export const metadata: Metadata = { title: 'Log in · Sentinel X' }

export default function LoginPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">Welcome back</h1>
      <p className="mb-6 text-sm text-slate-400">Log in to your Sentinel X account.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}
