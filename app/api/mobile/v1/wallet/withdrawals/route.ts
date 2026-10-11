import { listMyWithdrawalsEndpoint, requestWithdrawalEndpoint } from '@/lib/mobile-api/endpoints/wallet'

export const GET = listMyWithdrawalsEndpoint.handler
export const POST = requestWithdrawalEndpoint.handler
