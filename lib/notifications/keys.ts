// UNIQUE dedupe keys — the once-only guarantee for each notification type.
export const regKey = (registrationId: string) => `reg:${registrationId}`
export const reminderKey = (matchId: string, playerId: string) => `reminder:${matchId}:${playerId}`
export const fixtureKey = (matchId: string, playerId: string) => `fixture:${matchId}:${playerId}`
export const resultKey = (matchId: string, playerId: string) => `result:${matchId}:${playerId}`
export const prizeKey = (withdrawalId: string) => `prize:${withdrawalId}`
export const disqualifyKey = (registrationId: string) => `disqualify:${registrationId}`
export const noshowKey = (matchId: string, staffId: string) => `noshow:${matchId}:${staffId}`
