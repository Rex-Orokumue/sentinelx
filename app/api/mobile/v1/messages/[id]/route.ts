import { editMessageEndpoint, unsendMessageEndpoint } from '@/lib/mobile-api/endpoints/messages-writes'

export const PATCH = editMessageEndpoint.handler
export const DELETE = unsendMessageEndpoint.handler
