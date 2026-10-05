import { createAdminClient } from '@/lib/supabase/admin'
import { notifyStaff } from '@/lib/admin/staff'

export interface BudgetAlert { scope: string; ceiling: number; pct: number }

// Best-effort: tells staff once per UTC day per scope. The SQL function guarantees "once" (alerted_at).
export async function sendBudgetAlert(a: BudgetAlert): Promise<void> {
  console.warn('[chat-budget] ALERT', a)
  await notifyStaff(createAdminClient(), 'chat_budget_alert', {
    title: `Support chat budget at ${a.pct}%`,
    body: `The ${a.scope} daily chat ceiling (${a.ceiling}) has reached ${a.pct}%.`,
    link: '/admin',
  })
}
