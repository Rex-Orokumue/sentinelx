import { registerDeviceEndpoint, unregisterDeviceEndpoint } from '@/lib/mobile-api/endpoints/devices'

export const POST = registerDeviceEndpoint.handler
export const DELETE = unregisterDeviceEndpoint.handler
