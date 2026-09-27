import { followEndpoint, unfollowEndpoint } from '@/lib/mobile-api/endpoints/follows'

export const PUT = followEndpoint.handler
export const DELETE = unfollowEndpoint.handler
