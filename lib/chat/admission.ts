import { createHmac } from 'node:crypto'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { BudgetAlert } from './budget-alert'
import { sendBudgetAlert } from './budget-alert'

type Admin = ReturnType<typeof createAdminClient>

export interface ChatConfig { signedOutDailyCeiling: number; totalDailyCeiling: number; alertPct: number; pepper: string }

export function readChatConfig(env: Record<string, string | undefined> = process.env): ChatConfig {
  const pepper = env.CHAT_HASH_PEPPER
  if (!pepper) throw new Error('CHAT_HASH_PEPPER is required')
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d)
  return {
    signedOutDailyCeiling: n(env.CHAT_SIGNED_OUT_DAILY_CEILING, 500),
    totalDailyCeiling: n(env.CHAT_TOTAL_DAILY_CEILING, 1500),
    alertPct: Math.min(100, n(env.CHAT_ALERT_PCT, 80)),
    pepper,
  }
}

export function hashSubject(pepper: string, kind: 'ip' | 'device', value: string): string {
  return `${kind}:${createHmac('sha256', pepper).update(value).digest('hex').slice(0, 32)}`
}

export type Admission =
  | { ok: true }
  | { ok: false; code: 'chat_rate_limited'; retryAfterSeconds: number }
  | { ok: false; code: 'chat_unavailable' }

type Hit = { allowed: boolean; retry_after_seconds: number }
type Budget = { allowed: boolean; crossed_alert: boolean }

async function bucket(admin: Admin, subject: string, shortLimit: number, longLimit: number): Promise<Hit | null> {
  const { data, error } = await admin.rpc('chat_rate_limit_hit', {
    p_subject: subject, p_limit_short: shortLimit, p_window_short: 600, p_limit_long: longLimit, p_window_long: 86400,
  } as never)
  const row = (Array.isArray(data) ? data[0] : data) as Hit | null
  return error || !row ? null : row
}

export async function admitChatTurn(
  admin: Admin,
  who: { userId: string | null; ip: string | null; deviceId: string | null },
  cfg: ChatConfig = readChatConfig(),
  alert: (a: BudgetAlert) => Promise<void> = sendBudgetAlert,
): Promise<Admission> {
  const buckets: Array<[string, number, number]> = who.userId
    ? [[`player:${who.userId}`, 15, 120]]
    : [
        ...(who.deviceId ? [[hashSubject(cfg.pepper, 'device', who.deviceId), 6, 60] as [string, number, number]] : []),
        [hashSubject(cfg.pepper, 'ip', who.ip ?? 'unknown'), 30, 150],
      ]
  for (const [subject, s, l] of buckets) {
    const hit = await bucket(admin, subject, s, l)
    if (!hit) return { ok: false, code: 'chat_unavailable' } // fail closed
    if (!hit.allowed) return { ok: false, code: 'chat_rate_limited', retryAfterSeconds: hit.retry_after_seconds }
  }
  const budgets: Array<[string, number]> = [['total', cfg.totalDailyCeiling], ...(who.userId ? [] : [['signed_out', cfg.signedOutDailyCeiling] as [string, number]])]
  for (const [scope, ceiling] of budgets) {
    const { data, error } = await admin.rpc('chat_budget_hit', { p_scope: scope, p_ceiling: ceiling, p_alert_pct: cfg.alertPct } as never)
    const row = (Array.isArray(data) ? data[0] : data) as Budget | null
    if (error || !row || !row.allowed) return { ok: false, code: 'chat_unavailable' }
    if (row.crossed_alert) void alert({ scope, ceiling, pct: cfg.alertPct }).catch(() => {})
  }
  return { ok: true }
}
