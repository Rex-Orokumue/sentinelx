import { describe, it, expect } from 'vitest'
import { paginate, PAGE_SIZE } from './pagination'

describe('paginate', () => {
  it('describes the first page', () => {
    expect(paginate(1482, 1)).toMatchObject({
      page: 1,
      from: 1,
      to: 10,
      total: 1482,
      totalPages: 149,
    })
  })

  it('describes a middle page', () => {
    expect(paginate(1482, 3)).toMatchObject({ page: 3, from: 21, to: 30 })
  })

  it('caps the last page to the real total', () => {
    expect(paginate(1482, 149)).toMatchObject({ page: 149, from: 1481, to: 1482 })
  })

  it('clamps a page beyond the end', () => {
    expect(paginate(25, 99).page).toBe(3)
  })

  it('clamps a page below one', () => {
    expect(paginate(25, 0).page).toBe(1)
    expect(paginate(25, -5).page).toBe(1)
  })

  it('handles an empty list without going to page zero', () => {
    expect(paginate(0, 1)).toMatchObject({ page: 1, totalPages: 1, from: 0, to: 0, total: 0 })
  })

  it('exposes slice indices matching from/to', () => {
    const p = paginate(25, 2)
    expect(p.startIndex).toBe(10)
    expect(p.endIndex).toBe(20)
  })

  it('defaults to ten per page', () => {
    expect(PAGE_SIZE).toBe(10)
  })
})
