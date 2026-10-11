import { setPayoutAccountEndpoint, removePayoutAccountEndpoint } from '@/lib/mobile-api/endpoints/wallet'

export const PUT = setPayoutAccountEndpoint.handler
export const DELETE = removePayoutAccountEndpoint.handler
