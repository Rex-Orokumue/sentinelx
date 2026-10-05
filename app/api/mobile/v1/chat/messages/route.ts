import { postChatMessageEndpoint } from '@/lib/mobile-api/endpoints/chat'

export const runtime = 'nodejs'
// Worst case is two sequential 20 s upstream calls plus account reads.
export const maxDuration = 60
export const POST = postChatMessageEndpoint.handler
