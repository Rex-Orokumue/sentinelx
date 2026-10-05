/* eslint-disable @typescript-eslint/no-explicit-any -- loose fakes */
import { describe, it, expect, vi } from 'vitest'
import { admitChatTurn, hashSubject, readChatConfig } from './admission'

const cfg = { signedOutDailyCeiling: 500, totalDailyCeiling: 1500, alertPct: 80, pepper: 'p' }
function rpcAdmin(script: Record<string, unknown[]>) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const admin = { rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); const q = script[fn] ?? []; return { data: q.length > 1 ? q.shift() : q[0], error: null } }) }
  return { admin: admin as never, calls }
}
const ok = [{ allowed: true, retry_after_seconds: 0 }]
const budgetOk = [{ allowed: true, crossed_alert: false }]

describe('hashSubject', () => {
  it('is deterministic, pepper-dependent, and never contains the raw value', () => {
    const a = hashSubject('p1', 'ip', '41.58.1.2')
    expect(a).toBe(hashSubject('p1', 'ip', '41.58.1.2'))
    expect(a).not.toBe(hashSubject('p2', 'ip', '41.58.1.2'))
    expect(a.startsWith('ip:')).toBe(true)
    expect(a).not.toContain('41.58')
  })
})
describe('readChatConfig', () => {
  it('uses the owner defaults and env overrides', () => {
    expect(readChatConfig({ CHAT_HASH_PEPPER: 'x' })).toMatchObject({ signedOutDailyCeiling: 500, totalDailyCeiling: 1500, alertPct: 80 })
    expect(readChatConfig({ CHAT_HASH_PEPPER: 'x', CHAT_TOTAL_DAILY_CEILING: '900' }).totalDailyCeiling).toBe(900)
  })
  it('throws when the pepper is missing (a missing pepper must not silently weaken hashing)', () => {
    expect(() => readChatConfig({})).toThrow(/CHAT_HASH_PEPPER/)
  })
})
describe('admitChatTurn', () => {
  it('signed-in: one subject bucket then the total budget', async () => {
    const { admin, calls } = rpcAdmin({ chat_rate_limit_hit: ok, chat_budget_hit: budgetOk })
    expect(await admitChatTurn(admin, { userId: 'u1', ip: '1.1.1.1', deviceId: null }, cfg)).toEqual({ ok: true })
    expect(calls.map((c) => c[0])).toEqual(['chat_rate_limit_hit', 'chat_budget_hit'])
    expect(calls[0][1]).toMatchObject({ p_subject: 'player:u1', p_limit_short: 15, p_window_short: 600, p_limit_long: 120, p_window_long: 86400 })
  })
  it('signed-out: device then ip buckets, then total and signed_out budgets; raw ip never sent', async () => {
    const { admin, calls } = rpcAdmin({ chat_rate_limit_hit: ok, chat_budget_hit: budgetOk })
    await admitChatTurn(admin, { userId: null, ip: '41.58.1.2', deviceId: 'dev-1' }, cfg)
    expect(calls.map((c) => c[0])).toEqual(['chat_rate_limit_hit', 'chat_rate_limit_hit', 'chat_budget_hit', 'chat_budget_hit'])
    expect(JSON.stringify(calls)).not.toContain('41.58.1.2')
    expect(calls[2][1]).toMatchObject({ p_scope: 'total', p_ceiling: 1500, p_alert_pct: 80 })
    expect(calls[3][1]).toMatchObject({ p_scope: 'signed_out', p_ceiling: 500 })
  })
  it('signed-out with a device id cannot raise any limit: the ip bucket is always checked with its own caps', async () => {
    const { admin, calls } = rpcAdmin({ chat_rate_limit_hit: ok, chat_budget_hit: budgetOk })
    await admitChatTurn(admin, { userId: null, ip: '41.58.1.2', deviceId: 'dev-1' }, cfg)
    expect(calls[0][1]).toMatchObject({ p_limit_short: 6, p_limit_long: 60 })
    expect(calls[1][1]).toMatchObject({ p_limit_short: 30, p_limit_long: 150 })
  })
  it('signed-out with no ip still gets a bucket (the shared unknown one), never an unlimited pass', async () => {
    const { admin, calls } = rpcAdmin({ chat_rate_limit_hit: ok, chat_budget_hit: budgetOk })
    await admitChatTurn(admin, { userId: null, ip: null, deviceId: null }, cfg)
    expect(calls.filter((c) => c[0] === 'chat_rate_limit_hit')).toHaveLength(1)
    expect(calls[0][1]).toMatchObject({ p_subject: hashSubject('p', 'ip', 'unknown') })
  })
  it('a denied bucket returns chat_rate_limited with the retry-after and stops', async () => {
    const { admin, calls } = rpcAdmin({ chat_rate_limit_hit: [{ allowed: false, retry_after_seconds: 123 }] })
    expect(await admitChatTurn(admin, { userId: 'u1', ip: null, deviceId: null }, cfg)).toEqual({ ok: false, code: 'chat_rate_limited', retryAfterSeconds: 123 })
    expect(calls).toHaveLength(1)
  })
  it('an exhausted budget returns chat_unavailable', async () => {
    const { admin } = rpcAdmin({ chat_rate_limit_hit: ok, chat_budget_hit: [{ allowed: false, crossed_alert: false }] })
    expect(await admitChatTurn(admin, { userId: 'u1', ip: null, deviceId: null }, cfg)).toEqual({ ok: false, code: 'chat_unavailable' })
  })
  it('fires the alert exactly when the budget says it crossed, and an alert failure never fails the turn', async () => {
    const { admin } = rpcAdmin({ chat_rate_limit_hit: ok, chat_budget_hit: [{ allowed: true, crossed_alert: true }] })
    const alert = vi.fn().mockRejectedValue(new Error('smtp down'))
    expect(await admitChatTurn(admin, { userId: 'u1', ip: null, deviceId: null }, cfg, alert)).toEqual({ ok: true })
    expect(alert).toHaveBeenCalledTimes(1)
  })
  it('an rpc error fails closed as chat_unavailable', async () => {
    const admin = { rpc: async () => ({ data: null, error: { message: 'boom' } }) } as never
    expect(await admitChatTurn(admin, { userId: 'u1', ip: null, deviceId: null }, cfg)).toEqual({ ok: false, code: 'chat_unavailable' })
  })
})
