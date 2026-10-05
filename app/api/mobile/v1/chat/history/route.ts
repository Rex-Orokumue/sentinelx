import { getChatHistoryEndpoint, deleteChatHistoryEndpoint } from '@/lib/mobile-api/endpoints/chat'

export const GET = getChatHistoryEndpoint.handler
export const DELETE = deleteChatHistoryEndpoint.handler
