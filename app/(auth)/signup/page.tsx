import type { Metadata } from 'next'
import { SignupWizard } from '@/components/auth/SignupWizard'

export const metadata: Metadata = { title: 'Sign up · SentinelX Esports' }

export default function SignupPage({ searchParams }: { searchParams: { ref?: string } }) {
  return <SignupWizard refCode={searchParams.ref ?? null} />
}
