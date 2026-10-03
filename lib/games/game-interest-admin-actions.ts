'use server'
import { requireAdmin } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { groupGameInterestRows, buildContactCsv, buildContactNumbers } from '@/lib/games/game-interest-segment'
import { fetchGameInterestSegment } from '@/lib/games/game-interest-segment-query'

// Admin-only, checked here and not just on the page: a Server Action is a public
// POST endpoint, so hiding the page does not protect the contact list.
export async function exportContactNumbers(game?: string, country?: string): Promise<{ numbers: string[] }> {
  await requireAdmin()
  const rows = await fetchGameInterestSegment(createAdminClient(), { game, country })
  return { numbers: buildContactNumbers(groupGameInterestRows(rows)) }
}

export async function exportContactCsv(game?: string, country?: string): Promise<{ csv: string }> {
  await requireAdmin()
  const rows = await fetchGameInterestSegment(createAdminClient(), { game, country })
  return { csv: buildContactCsv(groupGameInterestRows(rows)) }
}
