import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useAdminDashboardStats } from '../useAdminDashboardStats'

function setupMocks(
  txRows: object[],
  tradeRows: object[],
  err1: null | { message: string } = null,
  err2: null | { message: string } = null,
) {
  mockFrom
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      gt: vi.fn().mockResolvedValue({ data: err1 ? null : txRows, error: err1 }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: err2 ? null : tradeRows, error: err2 }),
    })
}

const tx1 = { amount: 30, user_id: 'u1', profiles: { name: 'אבי', avatar_url: null } }
const tx2 = { amount: 10, user_id: 'u1', profiles: { name: 'אבי', avatar_url: null } }
const tx3 = { amount: 20, user_id: 'u2', profiles: { name: 'דנה', avatar_url: null } }

describe('useAdminDashboardStats', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnValue(new Promise(() => {})),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnValue(new Promise(() => {})),
      })
    const { result } = renderHook(() => useAdminDashboardStats())
    expect(result.current.loading).toBe(true)
  })

  it('computes weekly total, active trades, and sorted leaderboard', async () => {
    setupMocks([tx1, tx2, tx3], [{ id: 't1' }, { id: 't2' }])
    const { result } = renderHook(() => useAdminDashboardStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.totalCoinsThisWeek).toBe(60)   // 30+10+20
    expect(result.current.activeTradesCount).toBe(2)
    expect(result.current.leaderboard).toHaveLength(2)
    // u1 earned 40 (30+10), u2 earned 20 → sorted descending
    expect(result.current.leaderboard[0].userId).toBe('u1')
    expect(result.current.leaderboard[0].weeklyEarned).toBe(40)
    expect(result.current.leaderboard[1].userId).toBe('u2')
    expect(result.current.leaderboard[1].weeklyEarned).toBe(20)
    expect(result.current.error).toBeNull()
  })

  it('returns zero counts when no transactions or trades', async () => {
    setupMocks([], [])
    const { result } = renderHook(() => useAdminDashboardStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.totalCoinsThisWeek).toBe(0)
    expect(result.current.activeTradesCount).toBe(0)
    expect(result.current.leaderboard).toEqual([])
  })

  it('sets error when query fails', async () => {
    setupMocks([], [], { message: 'DB error' })
    const { result } = renderHook(() => useAdminDashboardStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
  })
})
