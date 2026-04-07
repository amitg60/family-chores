import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useCoinTransactions } from '../useCoinTransactions'
import type { CoinTransaction } from '../../types/database'

const fakeTx: CoinTransaction = {
  id: 'tx1',
  user_id: 'u1',
  family_id: 'f1',
  amount: 10,
  reason: 'chore_completed',
  related_entity_id: null,
  created_at: '2026-04-05T10:00:00Z',
}

const negTx: CoinTransaction = {
  id: 'tx2',
  user_id: 'u1',
  family_id: 'f1',
  amount: -5,
  reason: 'reward_redeemed',
  related_entity_id: null,
  created_at: '2026-04-04T10:00:00Z',
}

function setupMocks(
  recentRows: CoinTransaction[],
  allAmounts: { amount: number }[],
  err1: null | { message: string } = null,
  err2: null | { message: string } = null,
) {
  mockFrom
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: err1 ? null : recentRows, error: err1 }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: err2 ? null : allAmounts, error: err2 }),
    })
}

describe('useCoinTransactions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnValue(new Promise(() => {})),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnValue(new Promise(() => {})),
      })
    const { result } = renderHook(() => useCoinTransactions('u1'))
    expect(result.current.loading).toBe(true)
    expect(result.current.transactions).toEqual([])
  })

  it('returns transactions and computes totals from all rows', async () => {
    setupMocks([fakeTx, negTx], [{ amount: 10 }, { amount: -5 }, { amount: 20 }])
    const { result } = renderHook(() => useCoinTransactions('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.transactions).toHaveLength(2)
    expect(result.current.totalEarned).toBe(30)   // 10 + 20
    expect(result.current.totalSpent).toBe(5)     // abs(-5)
    expect(result.current.error).toBeNull()
  })

  it('sets error when any query fails', async () => {
    setupMocks([], [], { message: 'DB down' })
    const { result } = renderHook(() => useCoinTransactions('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB down')
  })

  it('returns empty results when userId is undefined', async () => {
    const { result } = renderHook(() => useCoinTransactions(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.transactions).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
