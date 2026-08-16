import { createClient } from '@/lib/supabase/server'

export interface CommunityStats {
  memberCount: number
  countryCount: number
  tournamentCount: number
}

// All three numbers are real (spec §4.2) — "Active Teams" from the mockup
// has no backing concept (teams are a v4 roadmap item) and is replaced with
// Tournaments Hosted. countryCount pulls every non-null `country` value and
// dedupes client-side — supabase-js has no COUNT(DISTINCT ...) shorthand;
// acceptable for a single text column at current scale, revisit with an RPC
// if the profiles table grows large enough for this to matter.
export async function fetchCommunityStats(): Promise<CommunityStats> {
  const supabase = createClient()
  const [{ count: memberCount }, { data: countryRows }, { count: tournamentCount }] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('country').not('country', 'is', null),
    supabase.from('tournaments').select('id', { count: 'exact', head: true }),
  ])
  const countryCount = new Set((countryRows ?? []).map((r) => r.country)).size
  return {
    memberCount: memberCount ?? 0,
    countryCount,
    tournamentCount: tournamentCount ?? 0,
  }
}
