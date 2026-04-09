import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockRpc } from '../../test/mocks/supabase'
import { useWeeklyPopulation } from '../useWeeklyPopulation'

const STORAGE_KEY = 'weeklyPopulated'
const FIXED_WEEK = '2026-04-06'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ profile: { id: 'u1', family_id: 'f1' } })),
}))

vi.mock('../../lib/weekStart', () => ({
  getCurrentWeekStart: vi.fn(() => FIXED_WEEK),
}))

describe('useWeeklyPopulation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockRpc.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('calls RPC with current week_start when no stored week', () => {
    renderHook(() => useWeeklyPopulation())
    expect(mockRpc).toHaveBeenCalledWith('populate_weekly_assignments', {
      p_week_start: FIXED_WEEK,
    })
  })

  it('does not call RPC when stored week matches current week', () => {
    localStorage.setItem(STORAGE_KEY, FIXED_WEEK)
    renderHook(() => useWeeklyPopulation())
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('calls RPC when stored week differs from current week', () => {
    localStorage.setItem(STORAGE_KEY, '2026-03-30')
    renderHook(() => useWeeklyPopulation())
    expect(mockRpc).toHaveBeenCalledWith('populate_weekly_assignments', {
      p_week_start: FIXED_WEEK,
    })
  })

  it('updates localStorage to current week after successful RPC', async () => {
    mockRpc.mockResolvedValue({ error: null })
    renderHook(() => useWeeklyPopulation())
    await vi.waitFor(() =>
      expect(localStorage.getItem(STORAGE_KEY)).toBe(FIXED_WEEK)
    )
  })

  it('does not call RPC when profile has no family_id', async () => {
    const { useAuth } = await import('../../contexts/AuthContext')
    vi.mocked(useAuth).mockReturnValueOnce({ profile: { id: 'u1', family_id: null } } as any)
    renderHook(() => useWeeklyPopulation())
    expect(mockRpc).not.toHaveBeenCalled()
  })
})
