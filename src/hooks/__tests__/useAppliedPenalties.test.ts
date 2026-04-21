import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../test/mocks/supabase'

import { useAppliedPenalties } from '../useAppliedPenalties'

const fakePenalty = {
  id: 'pen1',
  chore_assignment_id: 'a1',
  user_id: 'p1',
  coin_deduction: 1,
  reason: 'overdue',
  waived_by: null,
  waived_at: null,
  applied_at: '2026-04-19T23:59:00Z',
  batch_id: 'batch-1',
  chore_assignments: { chore_id: 'c1', chores: { title: 'כלי מטבח' } },
  profiles: { name: 'דנה', avatar_url: null },
}

const fakeReversedPenalty = {
  ...fakePenalty,
  id: 'pen2',
  waived_by: 'admin1',
  waived_at: '2026-04-20T10:00:00Z',
}

function makeFromMock(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
  mockFrom.mockReturnValue(builder)
  return builder
}

describe('useAppliedPenalties', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts loading', () => {
    makeFromMock(null)
    const { result } = renderHook(() => useAppliedPenalties())
    expect(result.current.loading).toBe(true)
  })

  it('returns penalties including reversed ones', async () => {
    makeFromMock([fakePenalty, fakeReversedPenalty])
    const { result } = renderHook(() => useAppliedPenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.penalties).toHaveLength(2)
    expect(result.current.penalties[1].waived_by).toBe('admin1')
  })

  it('sets error on failure', async () => {
    makeFromMock(null, { message: 'DB error' })
    const { result } = renderHook(() => useAppliedPenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
  })

  it('reverse calls reverse_penalty RPC', async () => {
    makeFromMock([fakePenalty])
    mockRpc.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useAppliedPenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.reverse('pen1')
    })
    expect(mockRpc).toHaveBeenCalledWith('reverse_penalty', { p_penalty_id: 'pen1' })
  })

  it('reverse returns error on RPC failure', async () => {
    makeFromMock([])
    mockRpc.mockResolvedValue({ error: { message: 'Already reversed' } })
    const { result } = renderHook(() => useAppliedPenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    let res: { error: string | null }
    await act(async () => {
      res = await result.current.reverse('pen1')
    })
    expect(res!.error).toBe('Already reversed')
  })
})
