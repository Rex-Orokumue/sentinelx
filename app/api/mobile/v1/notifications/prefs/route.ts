import { getNotificationPrefsEndpoint, patchNotificationPrefsEndpoint } from '@/lib/mobile-api/endpoints/notifications'

export const GET = getNotificationPrefsEndpoint.handler
export const PATCH = patchNotificationPrefsEndpoint.handler
