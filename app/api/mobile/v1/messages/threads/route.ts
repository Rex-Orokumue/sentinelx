import { getMessageThreadsEndpoint } from '@/lib/mobile-api/endpoints/messages-reads'
import { startMessageThreadEndpoint } from '@/lib/mobile-api/endpoints/messages-writes'

export const GET = getMessageThreadsEndpoint.handler
export const POST = startMessageThreadEndpoint.handler
