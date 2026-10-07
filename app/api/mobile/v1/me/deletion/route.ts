import { requestAccountDeletionEndpoint, cancelAccountDeletionEndpoint } from '@/lib/mobile-api/endpoints/account'
export const POST = requestAccountDeletionEndpoint.handler
export const DELETE = cancelAccountDeletionEndpoint.handler
