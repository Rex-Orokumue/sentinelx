// Pure — unit tested directly, no IO. Split out of player-economy-actions.ts
// because a 'use server' file's exports must all be async server actions,
// and PlayerEconomyPanel (a client component) imports the action functions
// directly, so webpack traces the whole module — any non-async export there
// fails the build. Mirrors lib/coins/decide.ts's split for the same reason.
export function validateGrantAmount(amount: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return 'Enter a whole amount greater than 0.'
  return null
}
