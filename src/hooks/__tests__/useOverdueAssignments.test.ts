import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../test/mocks/supabase'

import { useOverdueAssignments } from '../useOverdueAssignments'

const fakeAssignment = {
  id: 'a1',
  chore_id: 'c1',
  user_id: 'p1',
  calendar_day: 1,
  calendar_slot: 'morning',
  penalty_waived: false,
  chores: { title: 'כלי מטבח', coin_value: 10 },
  profiles: { name: 'דנה', avatar_url: null },
}

function makeFromMock(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
  mockFrom.mockReturnValue(builder)
  return builder
}

describe('useOverdueAssignments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts loading', () => {
    makeFromMock(null)
    const { result } = renderHook(() => useOverdueAssignments())
    expect(result.current.loading).toBe(true)
  })

  it('returns overdue assignments on success', async () => {
    makeFromMock([fakeAssignment])
    const { result } = renderHook(() => useOverdueAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.assignments).toHaveLength(1)
    expect(result.current.assignments[0].id).toBe('a1')
  })

  it('sets error on failure', async () => {
    makeFromMock(null, { message: 'DB error' })
    const { result } = renderHook(() => useOverdueAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
  })

  it('waive calls waive_assignment_penalty RPC', async () => {
    makeFromMock([fakeAssignment])
    mockRpc.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useOverdueAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.waive('a1')
    })
    expect(mockRpc).toHaveBeenCalledWith('waive_assignment_penalty', { p_assignment_id: 'a1' })
  })

  it('waive returns error message on RPC failure', async () => {
    makeFromMock([])
    mockRpc.mockResolvedValue({ error: { message: 'Not authorized' } })
    const { result } = renderHook(() => useOverdueAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    let res: { error: string | null }
    await act(async () => {
      res = await result.current.waive('a1')
    })
    expect(res!.error).toBe('Not authorized')
  })
})
