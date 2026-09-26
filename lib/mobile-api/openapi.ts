import { z } from 'zod'
import type { Endpoint } from './define-endpoint'

function schemaOf(s: z.ZodTypeAny): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(s) as Record<string, unknown>
  return rest
}

const ERROR_RESPONSES = {
  '400': { $ref: '#/components/responses/ValidationFailed' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '426': { $ref: '#/components/responses/UpgradeRequired' },
  '500': { $ref: '#/components/responses/Internal' },
}

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
})

export function buildOpenApi(endpoints: Endpoint[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const { meta } of [...endpoints].sort((a, b) => a.meta.path.localeCompare(b.meta.path) || a.meta.method.localeCompare(b.meta.method))) {
    const full = `/api/mobile/v1${meta.path}`
    paths[full] ??= {}
    paths[full][meta.method.toLowerCase()] = {
      operationId: meta.operationId,
      summary: meta.summary,
      security: meta.auth === 'public' ? [] : [{ bearerAuth: [] }],
      ...(meta.parameters ? { parameters: meta.parameters } : {}),
      ...(meta.body
        ? { requestBody: { required: true, content: { 'application/json': { schema: schemaOf(meta.body) } } } }
        : {}),
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              schema: { type: 'object', required: ['data'], properties: { data: schemaOf(meta.response) } },
            },
          },
        },
        ...ERROR_RESPONSES,
      },
    }
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Sentinel X Mobile API', version: '1' },
    servers: [{ url: 'https://sentinelxesports.com.ng' }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        ApiError: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                fields: { type: 'object', additionalProperties: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        ValidationFailed: errorResponse('Request body failed validation (code `validation_failed`).'),
        Unauthorized: errorResponse('Missing or invalid bearer token (code `unauthorized`).'),
        Forbidden: errorResponse('Authenticated but not allowed (code `forbidden`).'),
        UpgradeRequired: errorResponse('X-App-Version is below the supported minimum (code `app_update_required`).'),
        Internal: errorResponse('Unexpected server error (code `internal`).'),
      },
    },
  }
}
