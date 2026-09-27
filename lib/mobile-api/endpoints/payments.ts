import { z } from 'zod'
import { defineEndpoint } from '../define-endpoint'
import { confirmRegistration } from '@/lib/tournaments/confirm'

const paymentStatusResponse = z.object({
  status: z.enum(['confirmed', 'already_paid', 'not_found', 'not_successful']),
})

export const paymentStatusEndpoint = defineEndpoint({
  operationId: 'getPaymentStatus',
  method: 'GET',
  path: '/payments/{reference}',
  summary: "Poll a Paystack registration payment's confirmation status. The webhook remains the source of truth; this is UI polling only.",
  auth: 'user',
  response: paymentStatusResponse,
  handler: async ({ params }) => {
    const status = await confirmRegistration(params.reference)
    return { status }
  },
})
