import type { Endpoint } from '../define-endpoint'
import { configEndpoint } from './config'
import { meEndpoint, updateProfileEndpoint } from './me'
import { errorsEndpoint } from './client-errors'
import { registerDeviceEndpoint, unregisterDeviceEndpoint } from './devices'
import { sessionStartEndpoint } from './session'
import { signupEndpoint, resendConfirmationEndpoint, requestResetEndpoint } from './auth'
import { getGuideQuestsEndpoint, claimGuideBadgeEndpoint } from './guide'
import { postChatMessageEndpoint, getChatHistoryEndpoint, deleteChatHistoryEndpoint } from './chat'
import { claimUsernameEndpoint, completeProfileEndpoint } from './onboarding'
import { homeEndpoint } from './home'
import { rankingsEndpoint, rankingsMeEndpoint } from './rankings'
import { seasonsListEndpoint, seasonDetailEndpoint } from './seasons'
import { hallOfFameEndpoint } from './hall-of-fame'
import { registrationStateEndpoint, registerEndpoint, waitlistEndpoint } from './tournaments'
import { registrationFieldsEndpoint } from './registration-fields'
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
import { lobbyResultEndpoint } from './lobby-result'
import { summaryEndpoint } from './summary'
import { playersSearchEndpoint, playerProfileEndpoint, playerFollowersEndpoint, playerFollowingEndpoint } from './players'
import { myFollowsEndpoint, followEndpoint, unfollowEndpoint } from './follows'
import { myProgressEndpoint } from './progress'
import { xpEventsEndpoint, sxScoreEventsEndpoint, coinTransactionsEndpoint } from './histories'
import {
  communityFeedEndpoint,
  communityPostDetailEndpoint,
  communityCommentsEndpoint,
  communityChallengesEndpoint,
  communityBestPlayEndpoint,
  communityStatusesEndpoint,
  communityStatusViewersEndpoint,
  communityTopMembersEndpoint,
  communityUpcomingEventsEndpoint,
  communityGalleryEndpoint,
  communityStatsEndpoint,
} from './community-reads'
import {
  createCommunityPostEndpoint,
  deleteCommunityPostEndpoint,
  boostCommunityPostEndpoint,
  setCommunityReactionEndpoint,
  removeCommunityReactionEndpoint,
  createCommunityCommentEndpoint,
  deleteCommunityCommentEndpoint,
  createCommunityStatusEndpoint,
  deleteCommunityStatusEndpoint,
  viewCommunityStatusEndpoint,
  voteCommunityBestPlayEndpoint,
  reportCommunityPostEndpoint,
  reportCommunityCommentEndpoint,
} from './community-writes'
import {
  getNotificationPrefsEndpoint,
  patchNotificationPrefsEndpoint,
  getNotificationMutesEndpoint,
  postNotificationMuteEndpoint,
  deleteNotificationMuteEndpoint,
  postNotificationReadEndpoint,
  postNotificationsReadAllEndpoint,
  postTestPushEndpoint,
} from './notifications'
import { getMessageThreadsEndpoint, getMessageThreadEndpoint, getThreadMessagesEndpoint } from './messages-reads'
import { startMessageThreadEndpoint, sendMessageEndpoint, editMessageEndpoint, unsendMessageEndpoint, forwardMessageEndpoint, markThreadReadEndpoint, markAllDeliveredEndpoint, blockPlayerEndpoint, unblockPlayerEndpoint, reportThreadEndpoint, acceptMessageRequestEndpoint, declineMessageRequestEndpoint } from './messages-writes'

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
  completeProfileEndpoint,
  homeEndpoint,
  rankingsEndpoint,
  rankingsMeEndpoint,
  seasonsListEndpoint,
  seasonDetailEndpoint,
  hallOfFameEndpoint,
  registrationStateEndpoint,
  registrationFieldsEndpoint,
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
  lobbyResultEndpoint,
  summaryEndpoint,
  playersSearchEndpoint,
  playerProfileEndpoint,
  playerFollowersEndpoint,
  playerFollowingEndpoint,
  myFollowsEndpoint,
  followEndpoint,
  unfollowEndpoint,
  myProgressEndpoint,
  xpEventsEndpoint,
  sxScoreEventsEndpoint,
  coinTransactionsEndpoint,
  communityFeedEndpoint,
  communityPostDetailEndpoint,
  communityCommentsEndpoint,
  communityChallengesEndpoint,
  communityBestPlayEndpoint,
  communityStatusesEndpoint,
  communityStatusViewersEndpoint,
  communityTopMembersEndpoint,
  communityUpcomingEventsEndpoint,
  communityGalleryEndpoint,
  communityStatsEndpoint,
  createCommunityPostEndpoint,
  deleteCommunityPostEndpoint,
  boostCommunityPostEndpoint,
  setCommunityReactionEndpoint,
  removeCommunityReactionEndpoint,
  createCommunityCommentEndpoint,
  deleteCommunityCommentEndpoint,
  createCommunityStatusEndpoint,
  deleteCommunityStatusEndpoint,
  viewCommunityStatusEndpoint,
  voteCommunityBestPlayEndpoint,
  reportCommunityPostEndpoint,
  reportCommunityCommentEndpoint,
  getNotificationPrefsEndpoint,
  patchNotificationPrefsEndpoint,
  getNotificationMutesEndpoint,
  postNotificationMuteEndpoint,
  deleteNotificationMuteEndpoint,
  postNotificationReadEndpoint,
  postNotificationsReadAllEndpoint,
  postTestPushEndpoint,
  getMessageThreadsEndpoint,
  getMessageThreadEndpoint,
  getThreadMessagesEndpoint,
  startMessageThreadEndpoint,
  sendMessageEndpoint,
  editMessageEndpoint,
  unsendMessageEndpoint,
  forwardMessageEndpoint,
  markThreadReadEndpoint,
  markAllDeliveredEndpoint,
  blockPlayerEndpoint,
  unblockPlayerEndpoint,
  reportThreadEndpoint,
  acceptMessageRequestEndpoint,
  declineMessageRequestEndpoint,
  getGuideQuestsEndpoint,
  claimGuideBadgeEndpoint,
  postChatMessageEndpoint,
  getChatHistoryEndpoint,
  deleteChatHistoryEndpoint,
]
