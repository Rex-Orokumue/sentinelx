import { describe, it, expect } from 'vitest'
import { safeInternalPath } from './safe-path'

describe('safeInternalPath', () => {
  it('keeps a relative in-app path', () => {
    expect(safeInternalPath('/tournaments/abc', '/dashboard')).toBe('/tournaments/abc')
  })
  it('rejects a protocol-relative or absolute URL', () => {
    expect(safeInternalPath('//evil.com', '/dashboard')).toBe('/dashboard')
    expect(safeInternalPath('https://evil.com', '/dashboard')).toBe('/dashboard')
  })
  it('falls back when empty or missing', () => {
    expect(safeInternalPath('', '/dashboard')).toBe('/dashboard')
    expect(safeInternalPath(null, '/dashboard')).toBe('/dashboard')
    expect(safeInternalPath(undefined, '/dashboard')).toBe('/dashboard')
  })
})
