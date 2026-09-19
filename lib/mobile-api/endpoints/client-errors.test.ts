import { describe, it, expect } from 'vitest'
import { buildErrorRow } from './client-errors'

describe('buildErrorRow', () => {
  it('folds platform and app version into user_agent and truncates oversize text', () => {
    const row = buildErrorRow(
      { message: 'x'.repeat(5000), stack: 'y'.repeat(9000), route: '/tournaments/abc', platform: 'android', appVersion: '1.0.0+3', locale: 'pcm' },
      'u1',
    )
    expect(row.user_agent).toBe('sentinelx-mobile/1.0.0+3 (android)')
    expect(row.message).toHaveLength(4000)
    expect(row.stack).toHaveLength(8000)
    expect(row).toMatchObject({ user_id: 'u1', url: '/tournaments/abc', locale: 'pcm', digest: null })
  })
  it('records anonymous reports with a null user id', () => {
    expect(buildErrorRow({ message: 'boom', platform: 'ios', appVersion: '1.0.0' }, null).user_id).toBeNull()
  })
})
