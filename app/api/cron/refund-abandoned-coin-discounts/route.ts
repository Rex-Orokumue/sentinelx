import { createAdminClient } from '@/lib/supabase/admin'
import { refundAbandonedCoinDiscounts } from '@/lib/tournaments/coin-discount-refund'

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const admin = createAdminClient()
  const result = await refundAbandonedCoinDiscounts(admin)
  return Response.json(result)
}
