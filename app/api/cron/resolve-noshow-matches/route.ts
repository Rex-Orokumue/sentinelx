import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePendingNoShowMatches } from '@/lib/matches/noshow-actions'

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const { flagged } = await resolvePendingNoShowMatches(admin)

  return Response.json({ flagged })
}
