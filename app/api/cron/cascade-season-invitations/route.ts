import { createAdminClient } from '@/lib/supabase/admin'
import { expireAndCascadeInvitations } from '@/lib/seasons/invitation-actions'

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const admin = createAdminClient()
  const result = await expireAndCascadeInvitations(admin)
  return Response.json(result)
}
