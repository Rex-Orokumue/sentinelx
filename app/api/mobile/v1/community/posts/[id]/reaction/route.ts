import { setCommunityReactionEndpoint, removeCommunityReactionEndpoint } from '@/lib/mobile-api/endpoints/community-writes'

export const PUT = setCommunityReactionEndpoint.handler
export const DELETE = removeCommunityReactionEndpoint.handler
