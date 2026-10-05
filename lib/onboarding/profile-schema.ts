import { z } from 'zod'
import { postgresUuidSchema } from '@/lib/validation/postgres-uuid'

export const onboardingProfileSchema = z.object({
  country: z.string().trim().min(1, 'Select your country'),
  whatsapp: z.string().trim().min(1, 'Enter your WhatsApp number'),
  consentWhatsappUpdates: z.enum(['true', 'false']), // hidden input is always a string
  gameInterests: z.array(postgresUuidSchema).min(1, 'Select at least one game'),
})

export type OnboardingProfileInput = z.infer<typeof onboardingProfileSchema>

// The validated shape the completion service works on. The web form can only submit
// strings (a hidden input), so its schema takes 'true'/'false'; the mobile API sends
// a real JSON boolean and must NOT be coerced — an explicit false stays false and a
// missing or non-boolean value is rejected rather than defaulted.
export const onboardingProfileCoreSchema = z.object({
  country: z.string().trim().min(1, 'Select your country'),
  whatsapp: z.string().trim().min(1, 'Enter your WhatsApp number'),
  consentWhatsappUpdates: z.boolean(),
  gameInterests: z.array(postgresUuidSchema).min(1, 'Select at least one game'),
})

export type OnboardingProfileCore = z.infer<typeof onboardingProfileCoreSchema>

export function toOnboardingCore(web: OnboardingProfileInput): OnboardingProfileCore {
  return { ...web, consentWhatsappUpdates: web.consentWhatsappUpdates === 'true' }
}

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
