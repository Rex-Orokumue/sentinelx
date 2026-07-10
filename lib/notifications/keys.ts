// UNIQUE dedupe keys — the once-only guarantee for each notification type.
export const regKey = (registrationId: string) => `reg:${registrationId}`
export const reminderKey = (matchId: string, playerId: string) => `reminder:${matchId}:${playerId}`
export const resultKey = (matchId: string, playerId: string) => `result:${matchId}:${playerId}`
export const prizeKey = (withdrawalId: string) => `prize:${withdrawalId}`
