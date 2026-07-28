'use client'
import { useRouter } from 'next/navigation'
import { PhoneVerifyForm } from '@/components/onboarding/PhoneVerifyForm'

export function OnboardingPhoneClient() {
  const router = useRouter()
  return <PhoneVerifyForm onVerified={() => router.push('/dashboard')} />
}
