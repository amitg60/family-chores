import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useRewards } from '../useRewards'

const fakeReward = {
  id: 'r1',
  family_id: 'f1',
  title: 'גלידה',
  description: null,
  coin_cost: 20,
  type: 'store' as const,
  status: 'active' as const,
  proposed_by: null,
  approved_by: null,
  stock: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

describe('useRewards', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useRewards())
    expect(result.current.loading).toBe(true)
    expect(result.current.rewards).toEqual([])
  })

  it('returns rewards after successful fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeReward], error: null }))
    const { result } = renderHook(() => useRewards())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rewards).toEqual([fakeReward])
    expect(result.current.error).toBeNull()
  })

  it('sets error on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאת שרv' } }))
    const { result } = renderHook(() => useRewards())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאת שרv')
    expect(result.current.rewards).toEqual([])
  })

  it('refetch re-queries and updates rewards', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeReward], error: null }))
    const { result } = renderHook(() => useRewards())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const updated = { ...fakeReward, title: 'שוקולד' }
    mockFrom.mockReturnValue(makeFromMock({ data: [updated], error: null }))
    result.current.refetch()

    await waitFor(() => expect(result.current.rewards[0].title).toBe('שוקולד'))
  })
})
