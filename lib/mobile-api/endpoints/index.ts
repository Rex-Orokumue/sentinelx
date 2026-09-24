import type { Endpoint } from '../define-endpoint'
import { configEndpoint } from './config'
import { meEndpoint, updateProfileEndpoint } from './me'
import { errorsEndpoint } from './client-errors'
import { registerDeviceEndpoint, unregisterDeviceEndpoint } from './devices'
import { sessionStartEndpoint } from './session'
import { signupEndpoint, resendConfirmationEndpoint, requestResetEndpoint } from './auth'
import { claimUsernameEndpoint } from './onboarding'
import { homeEndpoint } from './home'
import { registrationStateEndpoint, registerEndpoint, waitlistEndpoint } from './tournaments'
import { acceptInvitationEndpoint, declineInvitationEndpoint } from './invitations'
import { paymentStatusEndpoint } from './payments'
import { bracketEndpoint } from './bracket'
import { standingsEndpoint } from './standings'
import { resultsEndpoint } from './results'
import { createSquadEndpoint, lookupSquadEndpoint } from './squads'
import { matchCentreEndpoint } from './match-centre'
import { checkInEndpoint } from './check-in'
import { matchResultEndpoint } from './match-result'
import { ratingEndpoint } from './rating'
import { wagerEndpoint } from './wager'

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
  registrationStateEndpoint,
  registerEndpoint,
  waitlistEndpoint,
  acceptInvitationEndpoint,
  declineInvitationEndpoint,
  paymentStatusEndpoint,
  bracketEndpoint,
  standingsEndpoint,
  resultsEndpoint,
  createSquadEndpoint,
  lookupSquadEndpoint,
  matchCentreEndpoint,
  checkInEndpoint,
  matchResultEndpoint,
  ratingEndpoint,
  wagerEndpoint,
]
