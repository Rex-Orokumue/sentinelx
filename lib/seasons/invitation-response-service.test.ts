import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/paystack/server', () => ({ initializeTransaction: vi.fn(), buildReference: vi.fn() }))
vi.mock('./invitation-actions', () => ({ cascadeNextInvitation: vi.fn() }))
vi.mock('@/lib/referrals/credit', () => ({ settleReferralForPaidEntry: vi.fn() }))
vi.mock('@/lib/notifications/notify', () => ({ notify: vi.fn() }))
import { performAcceptInvitation, performDeclineInvitation, performPayInvitationFromWallet } from './invitation-response-service'

beforeEach(() => {
  vi.clearAllMocks()
})

function fakeAdmin(opts: {
  invitation?: Record<string, unknown> | null
  claimedRows?: number
  insertError?: boolean
} = {}) {
  const defaultInvitation = {
    id: 'inv1', player_id: 'u1', status: 'pending', expires_at: new Date(Date.now() + 86_400_000).toISOString(), tournament_id: 't1',
    tournament: { id: 't1', slug: 'masters', title: 'Masters Cup', registration_fee: 500 },
  }
  const invitation = opts.invitation === undefined ? defaultInvitation : opts.invitation
  const status = !invitation || invitation.player_id !== 'u1'
    ? 'invitation_not_found'
    : opts.claimedRows === 0 || (invitation.status !== 'pending' && invitation.status !== 'accepted')
      ? 'invitation_no_longer_available'
      : new Date(invitation.expires_at as string).getTime() < Date.now() && invitation.status === 'pending'
        ? 'invitation_expired'
        : (invitation.tournament as { registration_fee?: number })?.registration_fee === 0
          ? 'confirmed' : 'pending'
  return {
    rpc: vi.fn().mockResolvedValue({
      data: { status, tournamentId: 't1', tournamentSlug: 'masters', fee: 500, registrationId: 'reg1' }, error: null,
    }),
    from: (table: string) => {
      if (table === 'tournament_invitations') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.invitation === undefined ? defaultInvitation : opts.invitation }) }) }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ select: async () => ({ data: opts.claimedRows === 0 ? [] : [{ id: 'inv1', tournament_id: 't1' }] }) }),
                select: async () => ({ data: opts.claimedRows === 0 ? [] : [{ id: 'inv1', tournament_id: 't1' }] }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as never
}

describe('performAcceptInvitation', () => {
  it('lets an accepted unpaid invitee restart payment', async () => {
    const { initializeTransaction, buildReference } = await import('@/lib/paystack/server')
    vi.mocked(buildReference).mockReturnValue('retry-ref')
    vi.mocked(initializeTransaction).mockResolvedValue('https://paystack.test/pay/retry-ref')
    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: { status: 'pending', tournamentId: 't1', tournamentSlug: 'masters', fee: 500, registrationId: 'reg1' }, error: null }),
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
    } as never
    expect(await performAcceptInvitation(admin, 'u1', 'inv1', 'ada@test.example')).toEqual({
      ok: true, status: 'pending', authorizationUrl: 'https://paystack.test/pay/retry-ref', reference: 'retry-ref', tournamentSlug: 'masters',
    })
  })

  it('charges wallet through the atomic database function and confirms an accepted unpaid invite', async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: { status: 'confirmed', tournamentSlug: 'masters' }, error: null }),
    } as never
    expect(await performPayInvitationFromWallet(admin, 'u1', 'inv1')).toEqual({ ok: true, status: 'confirmed', tournamentSlug: 'masters' })
    expect((admin as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith('pay_invitation_from_wallet', {
      p_player: 'u1', p_invitation: 'inv1',
    })
  })

  it('settles referral and notifies only for the first wallet debit', async () => {
    const { settleReferralForPaidEntry } = await import('@/lib/referrals/credit')
    const { notify } = await import('@/lib/notifications/notify')
    const admin = {
      rpc: vi.fn().mockResolvedValueOnce({ data: {
        status: 'confirmed', newlyPaid: true, tournamentSlug: 'masters', tournamentTitle: 'Masters Cup',
        registrationId: 'reg1', fee: 500,
      }, error: null }).mockResolvedValueOnce({ data: { status: 'confirmed', tournamentSlug: 'masters' }, error: null }),
    } as never
    await performPayInvitationFromWallet(admin, 'u1', 'inv1')
    await performPayInvitationFromWallet(admin, 'u1', 'inv1')
    expect(settleReferralForPaidEntry).toHaveBeenCalledTimes(1)
    expect(settleReferralForPaidEntry).toHaveBeenCalledWith(admin, 'u1', { registrationFee: 500, feeWaived: false })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'registration_confirmed', playerId: 'u1', tournament: 'Masters Cup' }))
  })

  it('reports insufficient wallet funds without creating a Paystack charge', async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: { status: 'insufficient' }, error: null }) } as never
    expect(await performPayInvitationFromWallet(admin, 'u1', 'inv1')).toEqual({ ok: false, errorCode: 'insufficient_wallet_balance' })
  })
  it('invitation_not_found for a missing or not-mine invitation', async () => {
    expect(await performAcceptInvitation(fakeAdmin({ invitation: null }), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'invitation_not_found' })
    expect(await performAcceptInvitation(fakeAdmin({ invitation: { id: 'inv1', player_id: 'someone-else', status: 'pending', expires_at: new Date(Date.now() + 1000).toISOString(), tournament_id: 't1', tournament: {} } }), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'invitation_not_found' })
  })
  it('invitation_no_longer_available when status is declined', async () => {
    expect(await performAcceptInvitation(fakeAdmin({ invitation: { id: 'inv1', player_id: 'u1', status: 'declined', expires_at: new Date(Date.now() + 1000).toISOString(), tournament_id: 't1', tournament: {} } }), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'invitation_no_longer_available' })
  })
  it('invitation_expired when past expires_at', async () => {
    expect(await performAcceptInvitation(fakeAdmin({ invitation: { id: 'inv1', player_id: 'u1', status: 'pending', expires_at: new Date(Date.now() - 1000).toISOString(), tournament_id: 't1', tournament: {} } }), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'invitation_expired' })
  })
  it('invitation_no_longer_available when a raced claim finds zero rows', async () => {
    expect(await performAcceptInvitation(fakeAdmin({ claimedRows: 0 }), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'invitation_no_longer_available' })
  })
  it('confirms immediately for a free tournament', async () => {
    const admin = fakeAdmin({ invitation: { id: 'inv1', player_id: 'u1', status: 'pending', expires_at: new Date(Date.now() + 1000).toISOString(), tournament_id: 't1', tournament: { id: 't1', slug: 'masters', title: 'Masters Cup', registration_fee: 0 } } })
    expect(await performAcceptInvitation(admin, 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: true, status: 'confirmed', tournamentSlug: 'masters' })
  })
  it('initializes Paystack and returns pending for a paid tournament', async () => {
    const { initializeTransaction, buildReference } = await import('@/lib/paystack/server')
    vi.mocked(buildReference).mockReturnValue('ref-1')
    vi.mocked(initializeTransaction).mockResolvedValue('https://paystack.test/pay/ref-1')
    expect(await performAcceptInvitation(fakeAdmin(), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: true, status: 'pending', authorizationUrl: 'https://paystack.test/pay/ref-1', reference: 'ref-1', tournamentSlug: 'masters' })
  })
  it('payment_init_failed without leaking the Paystack error', async () => {
    const { initializeTransaction, buildReference } = await import('@/lib/paystack/server')
    vi.mocked(buildReference).mockReturnValue('ref-1')
    vi.mocked(initializeTransaction).mockRejectedValue(new Error('secret detail'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await performAcceptInvitation(fakeAdmin(), 'u1', 'inv1', 'ada@test.example')).toEqual({ ok: false, errorCode: 'payment_init_failed' })
    spy.mockRestore()
  })
})

describe('performDeclineInvitation', () => {
  it('invitation_not_found when the claim finds zero rows', async () => {
    expect(await performDeclineInvitation(fakeAdmin({ claimedRows: 0 }), 'u1', 'inv1')).toEqual({ ok: false, errorCode: 'invitation_not_found' })
  })
  it('succeeds and cascades to the next invitee', async () => {
    const { cascadeNextInvitation } = await import('./invitation-actions')
    expect(await performDeclineInvitation(fakeAdmin(), 'u1', 'inv1')).toEqual({ ok: true })
    expect(cascadeNextInvitation).toHaveBeenCalledWith(expect.anything(), 't1')
  })
})
