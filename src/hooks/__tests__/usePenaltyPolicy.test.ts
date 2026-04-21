import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../test/mocks/supabase'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { family_id: 'f1' } }),
}))

import { usePenaltyPolicy } from '../usePenaltyPolicy'

const fakePolicy = {
  id: 'pol1',
  family_id: 'f1',
  overdue_day_deduction: 1,
  overdue_week_deduction: 5,
  per_chore_overrides: null,
  updated_by: null,
  updated_at: '2026-04-01T00:00:00Z',
}

function makeFromMock(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
  mockFrom.mockReturnValue(builder)
  return builder
}

describe('usePenaltyPolicy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts loading', () => {
    makeFromMock(null)
    const { result } = renderHook(() => usePenaltyPolicy())
    expect(result.current.loading).toBe(true)
  })

  it('returns policy on success', async () => {
    makeFromMock(fakePolicy)
    const { result } = renderHook(() => usePenaltyPolicy())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.policy?.overdue_day_deduction).toBe(1)
    expect(result.current.policy?.overdue_week_deduction).toBe(5)
  })

  it('returns null policy when no row exists', async () => {
    makeFromMock(null)
    const { result } = renderHook(() => usePenaltyPolicy())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.policy).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('sets error on failure', async () => {
    makeFromMock(null, { message: 'DB error' })
    const { result } = renderHook(() => usePenaltyPolicy())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
  })

  it('update calls update_penalty_policy RPC', async () => {
    makeFromMock(fakePolicy)
    mockRpc.mockResolvedValue({ error: null })
    const { result } = renderHook(() => usePenaltyPolicy())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.update(2, 10)
    })
    expect(mockRpc).toHaveBeenCalledWith('update_penalty_policy', {
      p_day_deduction: 2,
      p_week_deduction: 10,
    })
  })
})
