import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'

const onStaging = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('ofxmoxpvwbemfouaowoa')
if (onStaging) vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

describe.skipIf(!onStaging)('manual invitation payment on staging', () => {
  let admin: ReturnType<typeof createAdminClient>
  const stamp = Date.now()
  let actorId = ''
  let playerId = ''
  let tournamentId = ''
  const createdPlayers: string[] = []

  async function addInvitee(status: 'pending' | 'accepted' | 'expired') {
    const suffix = `${stamp}-${createdPlayers.length}`
    const user = await admin.auth.admin.createUser({ email: `zzqa+manual-${suffix}@example.com`,
      email_confirm: true, user_metadata: { username: `zzqa_m_${suffix}` } })
    if (user.error || !user.data.user) throw user.error ?? new Error('test player missing')
    createdPlayers.push(user.data.user.id)
    const invitation = await admin.from('tournament_invitations').insert({
      tournament_id: tournamentId, player_id: user.data.user.id, rank_at_invite: createdPlayers.length + 1,
      status, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    if (invitation.error) throw invitation.error
    return user.data.user.id
  }

  beforeAll(async () => {
    admin = createAdminClient()
    const [{ data: actor, error: actorError }, { data: player, error: playerError }] = await Promise.all([
      admin.auth.admin.createUser({ email: `zzqa+manual-admin-${stamp}@example.com`, email_confirm: true,
        user_metadata: { username: `zzqa_ma_${stamp}` } }),
      admin.auth.admin.createUser({ email: `zzqa+manual-player-${stamp}@example.com`, email_confirm: true,
        user_metadata: { username: `zzqa_mp_${stamp}` } }),
    ])
    if (actorError || playerError || !actor.user || !player.user) throw actorError ?? playerError ?? new Error('test users missing')
    actorId = actor.user.id
    playerId = player.user.id
    createdPlayers.push(playerId)
    const role = await admin.from('user_roles').insert({ user_id: actorId, role: 'admin' })
    if (role.error) throw role.error
    const game = await admin.from('games').select('id').limit(1).single()
    if (game.error || !game.data) throw game.error ?? new Error('game missing')
    const tournament = await admin.from('tournaments').insert({
      game_id: game.data.id, title: 'ZZQA Manual Masters', slug: `zzqa-manual-${stamp}`,
      tournament_type: 'masters', invitation_only: true, status: 'registration_open', registration_fee: 500, max_players: 16,
    }).select('id').single()
    if (tournament.error || !tournament.data) throw tournament.error ?? new Error('tournament missing')
    tournamentId = tournament.data.id
    const invitation = await admin.from('tournament_invitations').insert({
      tournament_id: tournamentId, player_id: playerId, rank_at_invite: 1,
      status: 'accepted', expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    if (invitation.error) throw invitation.error
  })

  afterAll(async () => {
    if (tournamentId) {
      const audit = await admin.from('manual_tournament_payments').delete().eq('tournament_id', tournamentId)
      const registrations = await admin.from('tournament_registrations').delete().eq('tournament_id', tournamentId)
      const invitations = await admin.from('tournament_invitations').delete().eq('tournament_id', tournamentId)
      const tournament = await admin.from('tournaments').delete().eq('id', tournamentId)
      if (audit.error || registrations.error || invitations.error || tournament.error) {
        throw audit.error ?? registrations.error ?? invitations.error ?? tournament.error
      }
    }
    for (const id of createdPlayers) await admin.auth.admin.deleteUser(id)
    if (actorId) await admin.auth.admin.deleteUser(actorId)
    const ids = [...createdPlayers, actorId].filter(Boolean)
    if (ids.length > 0) {
      const profiles = await admin.from('profiles').delete().in('id', ids)
      if (profiles.error) throw profiles.error
    }
  })

  it('confirms an accepted invite without a registration exactly once', async () => {
    const args = { p_tournament: tournamentId, p_player: playerId, p_actor: actorId,
      p_amount: 500, p_channel: 'bank_transfer', p_reference: `ZZQA-${stamp}`, p_note: 'verified test transfer' }
    const first = await admin.rpc('record_manual_invitation_payment', args)
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ status: 'confirmed', newlyPaid: true })
    const second = await admin.rpc('record_manual_invitation_payment', args)
    expect(second.data).toMatchObject({ status: 'already_paid' })
    const registrations = await admin.from('tournament_registrations').select('id, payment_status, payment_source')
      .eq('tournament_id', tournamentId).eq('player_id', playerId)
    expect(registrations.data).toHaveLength(1)
    expect(registrations.data?.[0]).toMatchObject({ payment_status: 'paid', payment_source: 'manual' })
  })

  it('rejects a reused bank reference and rolls back the other player’s entry', async () => {
    const another = await addInvitee('pending')
    const result = await admin.rpc('record_manual_invitation_payment', {
      p_tournament: tournamentId, p_player: another, p_actor: actorId, p_amount: 500,
      p_channel: 'bank_transfer', p_reference: `ZZQA-${stamp}`, p_note: null,
    })
    expect(result.error?.code).toBe('23505')
    const invitation = await admin.from('tournament_invitations').select('status')
      .eq('tournament_id', tournamentId).eq('player_id', another).single()
    expect(invitation.data?.status).toBe('pending')
    const registration = await admin.from('tournament_registrations').select('id')
      .eq('tournament_id', tournamentId).eq('player_id', another).maybeSingle()
    expect(registration.data).toBeNull()
  })

  it('checks fee and admin role before changing state', async () => {
    const another = await addInvitee('pending')
    const args = { p_tournament: tournamentId, p_player: another, p_actor: actorId,
      p_amount: 499, p_channel: 'bank_transfer', p_reference: `ZZQA-WRONG-${stamp}`, p_note: null }
    expect((await admin.rpc('record_manual_invitation_payment', args)).data).toMatchObject({ status: 'wrong_amount' })
    expect((await admin.rpc('record_manual_invitation_payment', { ...args, p_amount: 500, p_actor: another })).data)
      .toMatchObject({ status: 'not_admin' })
    const registration = await admin.from('tournament_registrations').select('id')
      .eq('tournament_id', tournamentId).eq('player_id', another).maybeSingle()
    expect(registration.data).toBeNull()
  })

  it('restores an expired invite only when a slot is free', async () => {
    const expired = await addInvitee('expired')
    await admin.from('tournaments').update({ max_players: 3 }).eq('id', tournamentId)
    const args = { p_tournament: tournamentId, p_player: expired, p_actor: actorId,
      p_amount: 500, p_channel: 'bank_transfer', p_reference: `ZZQA-EXPIRED-${stamp}`, p_note: null }
    expect((await admin.rpc('record_manual_invitation_payment', args)).data).toMatchObject({ status: 'no_slot' })
    await admin.from('tournaments').update({ max_players: 16 }).eq('id', tournamentId)
    expect((await admin.rpc('record_manual_invitation_payment', args)).data).toMatchObject({ status: 'confirmed' })
    const invitation = await admin.from('tournament_invitations').select('status')
      .eq('tournament_id', tournamentId).eq('player_id', expired).single()
    expect(invitation.data?.status).toBe('accepted')
  })

  it('settles an existing pending registration without replacing it', async () => {
    const accepted = await addInvitee('accepted')
    const pending = await admin.from('tournament_registrations').insert({
      tournament_id: tournamentId, player_id: accepted, payment_status: 'pending',
    }).select('id').single()
    if (pending.error || !pending.data) throw pending.error ?? new Error('pending registration missing')
    const paystackReference = `ZZQA-LATE-${stamp}`
    const attempt = await admin.from('tournament_payment_attempts').insert({
      registration_id: pending.data.id, paystack_reference: paystackReference,
    })
    if (attempt.error) throw attempt.error
    const result = await admin.rpc('record_manual_invitation_payment', {
      p_tournament: tournamentId, p_player: accepted, p_actor: actorId, p_amount: 500,
      p_channel: 'bank_transfer', p_reference: `ZZQA-PENDING-${stamp}`, p_note: null,
    })
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({ status: 'confirmed', registrationId: pending.data.id })
    const registration = await admin.from('tournament_registrations').select('id,payment_status,payment_source')
      .eq('id', pending.data.id).single()
    expect(registration.data).toMatchObject({ payment_status: 'paid', payment_source: 'manual' })
    const late = await admin.rpc('settle_invitation_paystack', {
      p_reference: paystackReference, p_amount_kobo: 50_000,
    })
    expect(late.error).toBeNull()
    expect(late.data).toMatchObject({ status: 'overpayment_credited' })
    const repeat = await admin.rpc('settle_invitation_paystack', {
      p_reference: paystackReference, p_amount_kobo: 50_000,
    })
    expect(repeat.data).toMatchObject({ status: 'already_paid' })
  })

  it('serializes concurrent retries so only one audit row is written', async () => {
    const player = await addInvitee('pending')
    const args = { p_tournament: tournamentId, p_player: player, p_actor: actorId,
      p_amount: 500, p_channel: 'bank_transfer', p_reference: `ZZQA-RACE-${stamp}`, p_note: null }
    const results = await Promise.all([
      admin.rpc('record_manual_invitation_payment', args),
      admin.rpc('record_manual_invitation_payment', args),
    ])
    expect(results.every(result => !result.error)).toBe(true)
    expect(results.map(result => (result.data as { status: string }).status).sort()).toEqual(['already_paid', 'confirmed'])
    const audits = await admin.from('manual_tournament_payments').select('id').eq('player_id', player)
    expect(audits.data).toHaveLength(1)
  })

  it('does not change a declined invitation or a closed tournament', async () => {
    const declined = await addInvitee('pending')
    await admin.from('tournament_invitations').update({ status: 'declined' })
      .eq('tournament_id', tournamentId).eq('player_id', declined)
    const args = { p_tournament: tournamentId, p_player: declined, p_actor: actorId,
      p_amount: 500, p_channel: 'bank_transfer', p_reference: `ZZQA-DECLINED-${stamp}`, p_note: null }
    expect((await admin.rpc('record_manual_invitation_payment', args)).data)
      .toMatchObject({ status: 'invitation_declined' })
    await admin.from('tournaments').update({ status: 'registration_closed' }).eq('id', tournamentId)
    expect((await admin.rpc('record_manual_invitation_payment', args)).data)
      .toMatchObject({ status: 'registration_closed' })
    await admin.from('tournaments').update({ status: 'registration_open' }).eq('id', tournamentId)
    const registration = await admin.from('tournament_registrations').select('id')
      .eq('tournament_id', tournamentId).eq('player_id', declined).maybeSingle()
    expect(registration.data).toBeNull()
  })
})
