// UNIQUE dedupe keys — the once-only guarantee for each notification type.
export const regKey = (registrationId: string) => `reg:${registrationId}`
export const reminderKey = (matchId: string, playerId: string) => `reminder:${matchId}:${playerId}`
export const fixtureKey = (matchId: string, playerId: string) => `fixture:${matchId}:${playerId}`
export const resultKey = (matchId: string, playerId: string) => `result:${matchId}:${playerId}`
export const prizeKey = (withdrawalId: string) => `prize:${withdrawalId}`
export const disqualifyKey = (registrationId: string) => `disqualify:${registrationId}`
export const noshowKey = (matchId: string, staffId: string) => `noshow:${matchId}:${staffId}`
// A re-invite reuses the (tournament, player) row, so it needs its own key: the
// original key is already spent and would silently suppress the new notice.
export const mastersReinviteKey = (tournamentId: string, playerId: string, deadline: string) =>
  `season_reinvite:${tournamentId}:${playerId}:${deadline}`
export const mastersInviteKey = (tournamentId: string, playerId: string) => `season_invite:${tournamentId}:${playerId}`
