import { describe, it, expect } from 'vitest'
import {
  ADMIN_TOURNAMENT_STATUS_FILTERS,
  filterStatusValues,
  isAdminTournamentStatusFilter,
} from './admin-filter'

describe('isAdminTournamentStatusFilter', () => {
  it('accepts every declared filter key', () => {
    for (const f of ADMIN_TOURNAMENT_STATUS_FILTERS) {
      expect(isAdminTournamentStatusFilter(f.key)).toBe(true)
    }
  })

  it('rejects unknown values and nullish input', () => {
    expect(isAdminTournamentStatusFilter('published')).toBe(false)
    expect(isAdminTournamentStatusFilter('')).toBe(false)
    expect(isAdminTournamentStatusFilter(undefined)).toBe(false)
    expect(isAdminTournamentStatusFilter(null)).toBe(false)
  })
})

describe('filterStatusValues', () => {
  it('returns null for "all" (no status constraint)', () => {
    expect(filterStatusValues('all')).toBeNull()
  })

  it('returns the matching status for a concrete filter', () => {
    expect(filterStatusValues('active')).toEqual(['active'])
    expect(filterStatusValues('registration_open')).toEqual(['registration_open'])
    expect(filterStatusValues('cancelled')).toEqual(['cancelled'])
  })

  it('every concrete filter maps to a real tournaments.status value', () => {
    const valid = new Set([
      'draft',
      'registration_open',
      'registration_closed',
      'active',
      'completed',
      'cancelled',
    ])
    for (const f of ADMIN_TOURNAMENT_STATUS_FILTERS) {
      if (f.key === 'all') continue
      for (const s of filterStatusValues(f.key) ?? []) {
        expect(valid.has(s)).toBe(true)
      }
    }
  })
})
