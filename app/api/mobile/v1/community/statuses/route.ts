import { communityStatusesEndpoint } from '@/lib/mobile-api/endpoints/community-reads'
import { createCommunityStatusEndpoint } from '@/lib/mobile-api/endpoints/community-writes'

export const GET = communityStatusesEndpoint.handler
export const POST = createCommunityStatusEndpoint.handler
