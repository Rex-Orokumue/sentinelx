import type { Metadata } from 'next'
import { SignupWizard } from '@/components/auth/SignupWizard'

export const metadata: Metadata = { title: 'Sign up · Sentinel X' }

export default function SignupPage() {
  return <SignupWizard />
}
