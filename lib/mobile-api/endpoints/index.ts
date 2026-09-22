import type { Endpoint } from '../define-endpoint'
import { configEndpoint } from './config'
import { meEndpoint, updateProfileEndpoint } from './me'
import { errorsEndpoint } from './client-errors'
import { registerDeviceEndpoint, unregisterDeviceEndpoint } from './devices'
import { sessionStartEndpoint } from './session'
import { signupEndpoint, resendConfirmationEndpoint, requestResetEndpoint } from './auth'
import { claimUsernameEndpoint } from './onboarding'
import { homeEndpoint } from './home'

// Single source of truth for the OpenAPI document. Append each new endpoint here.
export const ALL_ENDPOINTS: Endpoint[] = [
  configEndpoint,
  meEndpoint,
  updateProfileEndpoint,
  errorsEndpoint,
  registerDeviceEndpoint,
  unregisterDeviceEndpoint,
  sessionStartEndpoint,
  signupEndpoint,
  resendConfirmationEndpoint,
  requestResetEndpoint,
  claimUsernameEndpoint,
  homeEndpoint,
]
