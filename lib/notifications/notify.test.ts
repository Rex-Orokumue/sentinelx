import { describe, it, expect, vi, beforeEach } from 'vitest'

const maybeSingle = vi.fn()
const upsertSelectMaybeSingle = vi.fn()
const upsert = vi.fn(() => ({ select: () => ({ maybeSingle: upsertSelectMaybeSingle }) }))
const updateEq = vi.fn().mockResolvedValue({ error: null })
const update = vi.fn(() => ({ eq: updateEq }))
const from = vi.fn((table: string) => {
  if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle }) }) }
  if (table === 'notifications') return { upsert, update }
  return {}
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))

const sendWhatsApp = vi.fn()
vi.mock('./termii', () => ({ sendWhatsApp }))

// deferNotification hands the promise to the platform so it survives the
// response; in tests we just await it.
vi.mock('./defer', () => ({ deferNotification: (p: Promise<void>) => p }))

const translatorFor = vi.fn()
vi.mock('./locale', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./locale')>()),
  translatorFor,
}))

beforeEach(() => {
  maybeSingle.mockReset()
  maybeSingle.mockResolvedValue({
    data: { whatsapp_number: '08012345678', country: 'NG', locale: 'pcm' },
  })
  upsertSelectMaybeSingle.mockReset()
  upsertSelectMaybeSingle.mockResolvedValue({ data: { id: 'n1' } })
  sendWhatsApp.mockReset()
  sendWhatsApp.mockResolvedValue({ ok: true, providerRef: 'ref-1' })
  translatorFor.mockReset()
  translatorFor.mockResolvedValue((key: string) => `[${key}]`)
})

describe('notify renders in the recipient locale', () => {
  // The whole point of Part 8. The actor here is irrelevant — an English admin
  // confirming a result for a Pidgin player must produce Pidgin.
  it("uses the recipient's stored locale", async () => {
    const { notify } = await import('./notify')
    await notify({ playerId: 'p1', dedupeKey: 'd1', type: 'prize_credited', amount: '₦10,000' })
    expect(translatorFor).toHaveBeenCalledWith('pcm', 'notifications.whatsapp')
  })

  it('falls back to en when the profile has no locale', async () => {
    maybeSingle.mockResolvedValue({ data: { whatsapp_number: '08012345678', country: 'NG', locale: null } })
    const { notify } = await import('./notify')
    await notify({ playerId: 'p1', dedupeKey: 'd2', type: 'prize_credited', amount: '₦10,000' })
    expect(translatorFor).toHaveBeenCalledWith('en', 'notifications.whatsapp')
  })

  it('falls back to en for an unrecognised locale', async () => {
    maybeSingle.mockResolvedValue({ data: { whatsapp_number: '08012345678', country: 'NG', locale: 'de' } })
    const { notify } = await import('./notify')
    await notify({ playerId: 'p1', dedupeKey: 'd3', type: 'prize_credited', amount: '₦10,000' })
    expect(translatorFor).toHaveBeenCalledWith('en', 'notifications.whatsapp')
  })

  it('stores and sends the rendered body', async () => {
    const { notify } = await import('./notify')
    await notify({ playerId: 'p1', dedupeKey: 'd4', type: 'prize_credited', amount: '₦10,000' })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ template_name: 'prize_credited', body: '[prizeCredited]' }),
      expect.anything(),
    )
    expect(sendWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'prize_credited', body: '[prizeCredited]' }),
    )
  })

  // Best-effort contract: a translation failure must not break the caller's
  // primary action, and must not take the notification row with it.
  it('never throws into the caller', async () => {
    translatorFor.mockRejectedValue(new Error('catalog missing'))
    const { notify } = await import('./notify')
    await expect(
      notify({ playerId: 'p1', dedupeKey: 'd5', type: 'prize_credited', amount: '₦10,000' }),
    ).resolves.toBeUndefined()
  })
})
