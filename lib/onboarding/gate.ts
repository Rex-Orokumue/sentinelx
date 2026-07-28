export type OnboardingGate = '/onboarding/username' | '/onboarding/phone' | null

export function resolveOnboardingGate(profile: {
  username: string | null
  phoneVerifiedAt: string | null
}): OnboardingGate {
  if (profile.username === null) return '/onboarding/username'
  if (profile.phoneVerifiedAt === null) return '/onboarding/phone'
  return null
}
