import type { createAdminClient } from '@/lib/supabase/admin'
import type { RawGameInterestRow } from './game-interest-segment'

type Admin = ReturnType<typeof createAdminClient>

// PostgREST caps a response at 1000 rows by default, and this query returns one
// row per player per game — a single unpaged read would silently drop the tail
// of a large segment and the admin would export a short contact list.
const PAGE_SIZE = 1000

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await page(from, from + PAGE_SIZE - 1)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) return all
  }
}

// Players who opted in to WhatsApp updates and chose at least one game, with
// the optional filters applied. The country filter matches profiles.country
// exactly as stored — no normalization — and the consent filter is not
// optional: a player who said no never appears, whatever the page asks for.
//
// Service-role only: whatsapp_number and consent_whatsapp_updates are private
// profile columns (CLAUDE.md rule 10). Callers must have passed requireAdmin().
export async function fetchGameInterestSegment(
  admin: Admin,
  filter: { game?: string; country?: string },
): Promise<RawGameInterestRow[]> {
  const rows = await readAll<RawGameInterestRow>((from, to) => {
    let query = admin
      .from('game_interest')
      .select(
        'user_id, profiles!inner(id, username, display_name, country, whatsapp_number, consent_whatsapp_updates), games!inner(name)',
      )
      .eq('profiles.consent_whatsapp_updates', true)
    if (filter.game) query = query.eq('game_id', filter.game)
    if (filter.country) query = query.eq('profiles.country', filter.country)
    return query.order('user_id').order('game_id').range(from, to) as unknown as PromiseLike<{
      data: RawGameInterestRow[] | null
    }>
  })
  return rows
}

// For the country dropdown. Built from every consenting player, not from the
// filtered result — otherwise picking a country would leave only that country
// in the list and the admin could never switch to another.
export async function fetchConsentingCountries(admin: Admin): Promise<string[]> {
  const rows = await readAll<{ country: string | null }>((from, to) =>
    admin
      .from('profiles')
      .select('country')
      .eq('consent_whatsapp_updates', true)
      .order('id')
      .range(from, to) as unknown as PromiseLike<{ data: { country: string | null }[] | null }>,
  )
  return Array.from(new Set(rows.map((r) => r.country).filter((c): c is string => !!c))).sort()
}
