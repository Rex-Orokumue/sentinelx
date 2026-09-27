import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { Errors } from '../errors'
import { createAnonClient } from '../anon-client'
import { fetchRegistrationFields } from '@/lib/tournaments/registration-fields'

const fieldSchema = z.object({
  fieldKey: z.string(),
  label: z.string(),
  placeholder: z.string().nullable(),
  inputType: z.enum(['text', 'number', 'url']),
  required: z.boolean(),
  validationPattern: z.string().nullable(),
  validationMessage: z.string().nullable(),
})
const response = z.object({ fields: z.array(fieldSchema) })

export const registrationFieldsEndpoint = defineEndpoint({
  operationId: 'getTournamentRegistrationFields',
  method: 'GET',
  path: '/tournaments/{id}/registration-fields',
  summary: "The tournament's game-specific registration identity fields, for rendering a dynamic form.",
  auth: 'public',
  response,
  handler: async ({ ctx, params }) => {
    const supabase = ctx?.userClient ?? createAnonClient()
    const { data: tournament } = await supabase.from('tournaments').select('game_id').eq('id', params.id).maybeSingle()
    if (!tournament) throw Errors.notFound()
    const fields = await fetchRegistrationFields(supabase, tournament.game_id)
    return { fields: fields.map(({ showOnBracket: _showOnBracket, ...f }) => f) }
  },
})
