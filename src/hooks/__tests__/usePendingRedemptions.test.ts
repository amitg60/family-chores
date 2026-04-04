import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { usePendingRedemptions } from '../usePendingRedemptions'

const fakeRedemption = {
  id: 'red1',
  reward_id: 'r1',
  redeemed_by: 'p1',
  coin_cost_at_time: 20,
  status: 'pending' as const,
  redeemed_at: '2026-04-04T10:00:00Z',
  resolved_at: null,
  rewards: { title: 'גלידה', coin_cost: 20 },
  profiles: { name: 'דנה' },
}

function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

describe('usePendingRedemptions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => usePendingRedemptions())
    expect(result.current.loading).toBe(true)
    expect(result.current.redemptions).toEqual([])
  })

  it('returns redemptions with nested reward and player details', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeRedemption], error: null }))
    const { result } = renderHook(() => usePendingRedemptions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.redemptions).toEqual([fakeRedemption])
    expect(result.current.error).toBeNull()
  })

  it('sets error on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאה' } }))
    const { result } = renderHook(() => usePendingRedemptions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאה')
    expect(result.current.redemptions).toEqual([])
  })

  it('refetch re-queries', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeRedemption], error: null }))
    const { result } = renderHook(() => usePendingRedemptions())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockFrom.mockReturnValue(makeFromMock({ data: [], error: null }))
    result.current.refetch()
    await waitFor(() => expect(result.current.redemptions).toEqual([]))
  })
})
