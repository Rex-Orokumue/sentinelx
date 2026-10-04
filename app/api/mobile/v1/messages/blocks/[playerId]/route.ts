import { blockPlayerEndpoint, unblockPlayerEndpoint } from '@/lib/mobile-api/endpoints/messages-writes'

export const PUT = blockPlayerEndpoint.handler
export const DELETE = unblockPlayerEndpoint.handler
