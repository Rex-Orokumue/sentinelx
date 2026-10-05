import { z } from 'zod'
import { DESTINATIONS } from './types'

export const chatEventSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('status'), state: z.literal('checking_account') }),
  z.object({ t: z.literal('delta'), text: z.string() }),
  z.object({ t: z.literal('actions'), items: z.array(z.enum(DESTINATIONS)) }),
  z.object({ t: z.literal('done'), persisted: z.boolean() }),
  z.object({ t: z.literal('error'), code: z.enum(['chat_upstream', 'chat_truncated', 'internal']) }),
])
