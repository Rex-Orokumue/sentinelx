/* eslint-disable @typescript-eslint/no-explicit-any -- the generated document is inspected structurally */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineEndpoint } from './define-endpoint'
import { defineStreamEndpoint } from './define-stream-endpoint'
import { buildOpenApi } from './openapi'

const events = z.discriminatedUnion('t', [z.object({ t: z.literal('delta'), text: z.string() }), z.object({ t: z.literal('done') })])
const stream = defineStreamEndpoint({
  operationId: 'postStream', path: '/stream', summary: 'Stream', auth: 'public',
  body: z.object({ q: z.string() }), events, description: 'One JSON event per line.',
  handler: async () => (async function* () { yield { t: 'done' as const } })(),
})
const plain = defineEndpoint({
  operationId: 'getPlain', method: 'GET', path: '/plain', summary: 'Plain', auth: 'user',
  response: z.object({ ok: z.boolean() }), handler: async () => ({ ok: true }),
})

describe('buildOpenApi with a stream endpoint', () => {
  const doc = buildOpenApi([stream, plain]) as any
  const op = doc.paths['/api/mobile/v1/stream'].post

  it('documents the 200 as NDJSON with the event schema, not the { data } envelope', () => {
    const ok = op.responses['200']
    expect(ok.description).toBe('One JSON event per line.')
    expect(ok.content['application/x-ndjson']).toBeDefined()
    expect(ok.content['application/json']).toBeUndefined()
    const evSchema = ok.content['application/x-ndjson']['x-event-schema']
    expect(JSON.stringify(evSchema)).toContain('delta')
    expect(evSchema.$schema).toBeUndefined()
  })
  it('lists the pre-stream statuses a client must handle (429 rate limit, 503 unavailable) with Retry-After on 429', () => {
    expect(op.responses['429']).toBeDefined()
    expect(op.responses['503']).toBeDefined()
    const rl = doc.components.responses.RateLimited
    expect(rl.headers['Retry-After']).toBeDefined()
  })
  it('a public stream endpoint has no security requirement', () => {
    expect(op.security).toEqual([])
  })
  it('does not change non-stream operations (no 429/503, enveloped 200)', () => {
    const get = doc.paths['/api/mobile/v1/plain'].get
    expect(get.responses['429']).toBeUndefined()
    expect(get.responses['503']).toBeUndefined()
    expect(get.responses['200'].content['application/json'].schema.required).toEqual(['data'])
  })
})
