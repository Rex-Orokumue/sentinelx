import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineEndpoint } from './define-endpoint'
import { buildOpenApi } from './openapi'
import { ALL_ENDPOINTS } from './endpoints'

const ep = defineEndpoint({
  operationId: 'postThing', method: 'POST', path: '/thing', summary: 'Make a thing', auth: 'user',
  body: z.object({ name: z.string().min(2) }),
  response: z.object({ id: z.string() }),
  handler: async () => ({ id: 'x' }),
})
const pub = defineEndpoint({
  operationId: 'getOpen', method: 'GET', path: '/open', summary: 'Open', auth: 'public',
  parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }],
  response: z.object({ ok: z.boolean() }), handler: async () => ({ ok: true }),
})

describe('buildOpenApi', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = buildOpenApi([ep, pub]) as any

  it('declares OpenAPI 3.1 and bearer auth', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.components.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
  })
  it('prefixes paths with /api/mobile/v1 and keys operations by lower-case method', () => {
    expect(doc.paths['/api/mobile/v1/thing'].post.operationId).toBe('postThing')
    expect(doc.paths['/api/mobile/v1/open'].get.operationId).toBe('getOpen')
  })
  it('requires bearer auth for non-public endpoints only', () => {
    expect(doc.paths['/api/mobile/v1/thing'].post.security).toEqual([{ bearerAuth: [] }])
    expect(doc.paths['/api/mobile/v1/open'].get.security).toEqual([])
  })
  it('emits declared path and query parameters', () => {
    expect(doc.paths['/api/mobile/v1/open'].get.parameters).toEqual([
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
    ])
  })
  it('wraps the response in the {data} envelope and documents the error envelope', () => {
    const ok = doc.paths['/api/mobile/v1/thing'].post.responses['200'].content['application/json'].schema
    expect(ok.required).toEqual(['data'])
    expect(ok.properties.data.properties.id.type).toBe('string')
    expect(doc.components.schemas.ApiError.properties.error.required).toEqual(['code', 'message'])
  })
  it('emits the request body schema without a $schema key', () => {
    const body = doc.paths['/api/mobile/v1/thing'].post.requestBody.content['application/json'].schema
    expect(body.properties.name.minLength).toBe(2)
    expect(body.$schema).toBeUndefined()
  })
  it('has unique operation ids', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = buildOpenApi(ALL_ENDPOINTS) as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seen = Object.values(ids.paths).flatMap((p: any) => Object.values(p).map((o: any) => o.operationId))
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('committed contract', () => {
  it('openapi/mobile-v1.json is up to date — run `npm run openapi` if this fails', async () => {
    const doc = buildOpenApi(ALL_ENDPOINTS)
    await expect(JSON.stringify(doc, null, 2) + '\n').toMatchFileSnapshot('../../openapi/mobile-v1.json')
  })
})
