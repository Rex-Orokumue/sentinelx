import { getThreadMessagesEndpoint } from '@/lib/mobile-api/endpoints/messages-reads'
import { sendMessageEndpoint } from '@/lib/mobile-api/endpoints/messages-writes'

export const GET = getThreadMessagesEndpoint.handler
export const POST = sendMessageEndpoint.handler
