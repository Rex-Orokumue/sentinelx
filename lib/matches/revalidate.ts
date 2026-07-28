import { revalidatePath } from 'next/cache'

// Shared revalidation for anything that changes a match's outcome (confirm,
// dispute, no-show resolution). Kept out of verify-actions.ts/noshow-actions.ts
// because those files are 'use server' modules — every export there is treated
// as a server action and must be async, which a plain sync helper isn't.
export function revalidateAll(tournamentId: string, slug: string, matchId: string): void {
  revalidatePath('/admin/results')
  revalidatePath(`/admin/matches/${matchId}/review`)
  revalidatePath(`/admin/tournaments/${tournamentId}/bracket`)
  revalidatePath(`/matches/${matchId}`)
  if (slug) {
    revalidatePath(`/tournaments/${slug}`)
    revalidatePath(`/tournaments/${slug}/bracket`)
  }
}
