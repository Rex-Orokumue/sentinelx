import { describe, it, expect, vi, afterEach } from 'vitest'
import { isUsernameRetired, isIdentifierBanned } from './signup-blocks'

// Minimal fake matching the single query shape both functions use.
function fakeAdmin(opts: { retired?: string[]; banned?: string[] }) {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => {
              const list = table === 'retired_usernames' ? opts.retired : opts.banned
              return { data: (list ?? []).includes(val) ? { x: 1 } : null }
            },
          }),
        }),
      }
    },
  } as never
}

describe('isUsernameRetired', () => {
  it('is true for a retired username', async () => {
    expect(await isUsernameRetired(fakeAdmin({ retired: ['sniperking'] }), 'sniperking')).toBe(true)
  })

  // Retired handles are stored lowercase; a capitalised attempt must still
  // match or the block is trivially sidestepped.
  it('matches case-insensitively', async () => {
    expect(await isUsernameRetired(fakeAdmin({ retired: ['sniperking'] }), 'SniperKing')).toBe(true)
  })

  it('ignores surrounding whitespace', async () => {
    expect(await isUsernameRetired(fakeAdmin({ retired: ['sniperking'] }), '  sniperking ')).toBe(
      true,
    )
  })

  it('is false for a free username', async () => {
    expect(await isUsernameRetired(fakeAdmin({ retired: [] }), 'newname')).toBe(false)
  })
})

describe('isIdentifierBanned', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is false when nothing matches', async () => {
    expect(await isIdentifierBanned(fakeAdmin({ banned: [] }), 'a@b.com')).toBe(false)
  })

  it('is true when the hash matches', async () => {
    vi.stubEnv('DELETION_HASH_PEPPER', 'p')
    const { hashIdentifier } = await import('@/lib/settings/identifier-hash')
    const hash = hashIdentifier('a@b.com', 'p')
    expect(await isIdentifierBanned(fakeAdmin({ banned: [hash] }), 'a@b.com')).toBe(true)
  })

  it('matches a differently-cased address', async () => {
    vi.stubEnv('DELETION_HASH_PEPPER', 'p')
    const { hashIdentifier } = await import('@/lib/settings/identifier-hash')
    const hash = hashIdentifier('a@b.com', 'p')
    expect(await isIdentifierBanned(fakeAdmin({ banned: [hash] }), 'A@B.CoM')).toBe(true)
  })
})
