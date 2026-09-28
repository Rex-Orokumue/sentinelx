import { communityPostDetailEndpoint } from '@/lib/mobile-api/endpoints/community-reads'
import { deleteCommunityPostEndpoint } from '@/lib/mobile-api/endpoints/community-writes'

export const GET = communityPostDetailEndpoint.handler
export const DELETE = deleteCommunityPostEndpoint.handler
