import { describe, it, expect } from 'vitest'
import { mapTransactionRows, type RawWalletTxnRow } from './transactions'

describe('mapTransactionRows', () => {
  it('is always completed for a non-withdrawal type', () => {
    const row: RawWalletTxnRow = {
      id: 't1', type: 'prize', category: 'tournament_prize', amount: 5000,
      reference_id: null, note: null, created_at: '2026-07-20T00:00:00Z',
    }
    expect(mapTransactionRows([row], new Map())[0].status).toBe('completed')
  })

  it('derives status from the matching withdrawal_requests row for a withdrawal_request type', () => {
    const row: RawWalletTxnRow = {
      id: 't2', type: 'withdrawal_request', category: 'withdrawal', amount: -3000,
      reference_id: 'wr1', note: null, created_at: '2026-07-18T00:00:00Z',
    }
    const byId = new Map([['wr1', 'pending']])
    expect(mapTransactionRows([row], byId)[0].status).toBe('pending')
  })

  it('maps a rejected withdrawal_requests status to failed', () => {
    const row: RawWalletTxnRow = {
      id: 't3', type: 'withdrawal_request', category: 'withdrawal', amount: -3000,
      reference_id: 'wr2', note: null, created_at: '2026-07-18T00:00:00Z',
    }
    const byId = new Map([['wr2', 'rejected']])
    expect(mapTransactionRows([row], byId)[0].status).toBe('failed')
  })

  it('a withdrawal_reversal is always completed (the reversal already happened)', () => {
    const row: RawWalletTxnRow = {
      id: 't4', type: 'withdrawal_reversal', category: 'withdrawal', amount: 3000,
      reference_id: 'wr2', note: null, created_at: '2026-07-19T00:00:00Z',
    }
    expect(mapTransactionRows([row], new Map([['wr2', 'rejected']]))[0].status).toBe('completed')
  })
})
