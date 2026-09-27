import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('../anon-client', () => ({ createAnonClient: vi.fn() }))
import { registrationFieldsEndpoint } from './registration-fields'

describe('registrationFieldsEndpoint', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.test.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-stub')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-stub')
  })

  it('404s when the tournament does not exist', async () => {
    const { createAnonClient } = await import('../anon-client')
    vi.mocked(createAnonClient).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    } as never)
    const res = await registrationFieldsEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/t1/registration-fields'),
      { params: { id: 't1' } },
    )
    expect(res.status).toBe(404)
  })

  it('returns the game fields for a known tournament', async () => {
    const { createAnonClient } = await import('../anon-client')
    vi.mocked(createAnonClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'tournaments') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { game_id: 'g1' } }) }) }) }
        if (table === 'game_registration_fields') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: async () => ({
                    data: [{ field_key: 'in_game_uid', label: 'In-game UID', placeholder: null, input_type: 'text', required: true, validation_pattern: null, validation_message: null, show_on_bracket: true }],
                  }),
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    } as never)
    const res = await registrationFieldsEndpoint.handler(
      new Request('https://x.test/api/mobile/v1/tournaments/t1/registration-fields'),
      { params: { id: 't1' } },
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.fields).toEqual([
      { fieldKey: 'in_game_uid', label: 'In-game UID', placeholder: null, inputType: 'text', required: true, validationPattern: null, validationMessage: null },
    ])
  })
})
