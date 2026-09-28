import { communityCommentsEndpoint } from '@/lib/mobile-api/endpoints/community-reads'
import { createCommunityCommentEndpoint } from '@/lib/mobile-api/endpoints/community-writes'

export const GET = communityCommentsEndpoint.handler
export const POST = createCommunityCommentEndpoint.handler
