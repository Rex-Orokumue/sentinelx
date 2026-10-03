import {
  getNotificationMutesEndpoint,
  postNotificationMuteEndpoint,
  deleteNotificationMuteEndpoint,
} from '@/lib/mobile-api/endpoints/notifications'

export const GET = getNotificationMutesEndpoint.handler
export const POST = postNotificationMuteEndpoint.handler
export const DELETE = deleteNotificationMuteEndpoint.handler
