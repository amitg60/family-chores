import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useChoreAssignments } from '../useChoreAssignments'

vi.mock('../../lib/weekStart', () => ({
  getCurrentWeekStart: vi.fn(() => '2026-04-05'),
}))

const fakeAssignment = {
  id: 'a1',
  chore_id: 'c1',
  user_id: 'u1',
  week_start: '2026-04-05',
  calendar_day: null,
  calendar_slot: null,
  reminder_enabled: false,
  status: 'pending' as const,
  archived: false,
  created_at: '2026-04-05T00:00:00Z',
  updated_at: '2026-04-05T00:00:00Z',
}

// Builds a mock for: .from(...).select('*').eq(...).eq(...).eq(...).order(...)
function makeChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.order = vi.fn().mockResolvedValue(resolvedValue)
  return chain
}

describe('useChoreAssignments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts with loading=true', () => {
    mockFrom.mockReturnValue(makeChain(new Promise(() => {})))
    const { result } = renderHook(() => useChoreAssignments('u1'))
    expect(result.current.loading).toBe(true)
  })

  it('returns assignments on success', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [fakeAssignment], error: null }))
    const { result } = renderHook(() => useChoreAssignments('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.assignments).toHaveLength(1)
    expect(result.current.assignments[0].id).toBe('a1')
  })

  it('returns error string on query failure', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'DB error' } }))
    const { result } = renderHook(() => useChoreAssignments('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
    expect(result.current.assignments).toHaveLength(0)
  })

  it('does not query Supabase when userId is undefined', async () => {
    const { result } = renderHook(() => useChoreAssignments(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
