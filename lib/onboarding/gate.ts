export type OnboardingGate = '/onboarding/username' | '/onboarding/phone' | null

// Phone verification is fully built (lib/phone/*, /onboarding/phone, the
// dashboard settings card) but not enforced yet — the Meta WhatsApp Business
// Manager setup (app, business verification, Authentication template
// approval) is a manual, separate task that's been deferred. Flip this to
// true once that's done and META_WHATSAPP_TOKEN/META_WHATSAPP_PHONE_NUMBER_ID
// are live; see docs/superpowers/specs/2026-07-28-google-signin-phone-whatsapp-verification-design.md.
export const ENFORCE_PHONE_VERIFICATION = false

export function resolveOnboardingGate(profile: {
  username: string | null
  phoneVerifiedAt: string | null
}): OnboardingGate {
  if (profile.username === null) return '/onboarding/username'
  if (ENFORCE_PHONE_VERIFICATION && profile.phoneVerifiedAt === null) return '/onboarding/phone'
  return null
}
