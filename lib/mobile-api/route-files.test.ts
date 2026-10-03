import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_ENDPOINTS } from './endpoints'

// An endpoint can be defined, registered in ALL_ENDPOINTS and published in the OpenAPI
// document yet still 404 if nobody added its Next.js route file. Types, lint, the build and
// the OpenAPI snapshot all pass in that state — the contract promises a path that does not
// exist. This test is the only thing that closes that gap.
describe('mobile API route files', () => {
  const root = join(process.cwd(), 'app', 'api', 'mobile', 'v1')

  it.each(ALL_ENDPOINTS.map((e) => [`${e.meta.method} ${e.meta.path}`, e.meta] as const))('%s has a route file exporting its method', (_label, meta) => {
    // OpenAPI '/tournaments/{id}/register' -> app/api/mobile/v1/tournaments/[id]/register/route.ts
    const dir = meta.path
      .split('/')
      .filter(Boolean)
      .map((seg) => seg.replace(/^\{(.+)\}$/, '[$1]'))
    const file = join(root, ...dir, 'route.ts')
    expect(existsSync(file), `missing ${file}`).toBe(true)
    expect(readFileSync(file, 'utf8')).toMatch(new RegExp(`export\\s+const\\s+${meta.method}\\b`))
  })
})
