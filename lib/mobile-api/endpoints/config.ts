import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { SITE_URL } from '@/lib/seo/site'
import { COINS_HALF_ENTRY, COINS_PER_ENTRY, COINS_PER_NAIRA, NAIRA_PER_COIN } from '@/lib/coins/value'
import { ENFORCE_PHONE_VERIFICATION } from '@/lib/onboarding/gate'

// One key per app surface a store reviewer or regulator could force us to hide (spec §14).
const FEATURE_KEYS = ['community', 'exchange', 'friendlies', 'messages', 'store', 'tv', 'wagering'] as const

export function featureFlags(off: string | undefined): Record<string, boolean> {
  const disabled = new Set((off ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, !disabled.has(k)]))
}

const configResponse = z.object({
  minSupportedAppVersion: z.string(),
  latestAppVersion: z.string(),
  maintenance: z.object({ message: z.string() }).nullable(),
  siteUrl: z.string(),
  coins: z.object({
    coinsPerNaira: z.number(),
    nairaPerCoin: z.number(),
    coinsPerEntry: z.number(),
    coinsHalfEntry: z.number(),
  }),
  enforcePhoneVerification: z.boolean(),
  whatsappCommunityUrl: z.string().nullable(),
  features: z.record(z.string(), z.boolean()),
})
export type ConfigResponse = z.infer<typeof configResponse>

export function buildConfig(env: Partial<NodeJS.ProcessEnv>): ConfigResponse {
  const community = env.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL
  const maintenance = env.MOBILE_MAINTENANCE_MESSAGE?.trim()
  return {
    minSupportedAppVersion: env.MOBILE_MIN_APP_VERSION ?? '0.0.0',
    latestAppVersion: env.MOBILE_LATEST_APP_VERSION ?? '1.0.0',
    maintenance: maintenance ? { message: maintenance } : null,
    siteUrl: SITE_URL,
    coins: {
      coinsPerNaira: COINS_PER_NAIRA,
      nairaPerCoin: NAIRA_PER_COIN,
      coinsPerEntry: COINS_PER_ENTRY,
      coinsHalfEntry: COINS_HALF_ENTRY,
    },
    enforcePhoneVerification: ENFORCE_PHONE_VERIFICATION,
    whatsappCommunityUrl: community && community !== '#' ? community : null,
    features: featureFlags(env.MOBILE_FEATURES_OFF),
  }
}

export const configEndpoint = defineEndpoint({
  operationId: 'getConfig',
  method: 'GET',
  path: '/config',
  summary: 'Runtime configuration, kill-switch and feature flags (unauthenticated, cacheable).',
  auth: 'public',
  skipVersionGate: true, // the update-required screen needs to read this
  cacheControl: 'public, s-maxage=60, stale-while-revalidate=300',
  response: configResponse,
  handler: async () => buildConfig(process.env),
})
