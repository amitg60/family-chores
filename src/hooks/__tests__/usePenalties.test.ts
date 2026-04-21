import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'

import { usePenalties } from '../usePenalties'

const fakePenalty = {
  id: 'pen1',
  chore_assignment_id: 'a1',
  user_id: 'p1',
  coin_deduction: 1,
  reason: 'overdue',
  waived_by: null,
  waived_at: null,
  applied_at: '2026-04-19T23:59:00Z',
  batch_id: 'batch-uuid-1',
  chore_assignments: { chore_id: 'c1', chores: { title: 'כלי מטבח' } },
}

const fakePenaltyWaived = {
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

describe('usePenalties', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    makeFromMock(null)
    const { result } = renderHook(() => usePenalties())
    expect(result.current.loading).toBe(true)
  })

  it('returns penalties on success', async () => {
    makeFromMock([fakePenalty, fakePenaltyWaived])
    const { result } = renderHook(() => usePenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.penalties).toHaveLength(2)
    expect(result.current.penalties[0].id).toBe('pen1')
    expect(result.current.error).toBeNull()
  })

  it('marks waived penalty correctly', async () => {
    makeFromMock([fakePenaltyWaived])
    const { result } = renderHook(() => usePenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.penalties[0].waived_by).toBe('admin1')
  })

  it('returns empty array when no penalties', async () => {
    makeFromMock([])
    const { result } = renderHook(() => usePenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.penalties).toHaveLength(0)
  })

  it('sets error on failure', async () => {
    makeFromMock(null, { message: 'DB error' })
    const { result } = renderHook(() => usePenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
    expect(result.current.penalties).toHaveLength(0)
  })

  it('queries penalties table with correct select and order', async () => {
    const builder = makeFromMock([])
    const { result } = renderHook(() => usePenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFrom).toHaveBeenCalledWith('penalties')
    expect(builder.select).toHaveBeenCalledWith(
      '*, chore_assignments(chore_id, chores(title))'
    )
    expect(builder.order).toHaveBeenCalledWith('applied_at', { ascending: false })
  })
})
