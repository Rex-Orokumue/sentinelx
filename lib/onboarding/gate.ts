export type OnboardingGate = '/onboarding/username' | null

// Extended in the phone-verification plan to also check phone_verified_at —
// see docs/superpowers/plans/2026-07-28-phone-whatsapp-verification.md.
export function resolveOnboardingGate(profile: { username: string | null }): OnboardingGate {
  return profile.username === null ? '/onboarding/username' : null
}
