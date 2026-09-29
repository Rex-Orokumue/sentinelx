import { z } from 'zod'

export const onboardingProfileSchema = z.object({
  country: z.string().trim().min(1, 'Select your country'),
  whatsapp: z.string().trim().min(1, 'Enter your WhatsApp number'),
  consentWhatsappUpdates: z.enum(['true', 'false']), // hidden input is always a string
  gameInterests: z.array(z.string().uuid()).min(1, 'Select at least one game'),
})

export type OnboardingProfileInput = z.infer<typeof onboardingProfileSchema>

// gameInterests arrives as repeated FormData entries under one key (one per
// checked game checkbox). Extracted as its own function so the actual
// FormData-reading logic — not just the schema it feeds — has a test with a
// real FormData object exercising it.
export function parseOnboardingProfileFormData(formData: FormData) {
  return {
    country: String(formData.get('country') ?? ''),
    whatsapp: String(formData.get('whatsapp') ?? ''),
    consentWhatsappUpdates: String(formData.get('consentWhatsappUpdates') ?? ''),
    gameInterests: formData.getAll('gameInterests').map(String),
  }
}
