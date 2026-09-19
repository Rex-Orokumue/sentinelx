import { describe, it, expect } from 'vitest'
import { compareVersions } from './version'

describe('compareVersions', () => {
  it('orders dotted numeric versions', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
  })
  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
  })
  it('ignores the +build suffix Flutter appends', () => {
    expect(compareVersions('1.0.0+45', '1.0.0')).toBe(0)
  })
  it('treats missing segments as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1', '1.0.1')).toBe(-1)
  })
  it('treats an unparseable version as 0.0.0', () => {
    expect(compareVersions('garbage', '0.0.1')).toBe(-1)
  })
})
