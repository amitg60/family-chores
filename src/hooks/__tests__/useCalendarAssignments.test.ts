import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useCalendarAssignments } from '../useCalendarAssignments'

const fakeAssignment = {
  id: 'a1',
  chore_id: 'c1',
  user_id: 'u1',
  week_start: '2026-03-29',
  calendar_day: 1,
  calendar_slot: 'morning' as const,
  reminder_enabled: false,
  status: 'pending' as const,
  archived: false,
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T10:00:00Z',
  chores: { title: 'כלים', coin_value: 10 },
  profiles: { name: 'דנה', avatar_url: null },
}

function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

describe('useCalendarAssignments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useCalendarAssignments())
    expect(result.current.loading).toBe(true)
    expect(result.current.assignments).toEqual([])
  })

  it('returns assignments with chore and profile details', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeAssignment], error: null }))
    const { result } = renderHook(() => useCalendarAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.assignments).toEqual([fakeAssignment])
    expect(result.current.error).toBeNull()
  })

  it('sets error on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאה' } }))
    const { result } = renderHook(() => useCalendarAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאה')
    expect(result.current.assignments).toEqual([])
  })

  it('refetch re-queries', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeAssignment], error: null }))
    const { result } = renderHook(() => useCalendarAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockFrom.mockReturnValue(makeFromMock({ data: [], error: null }))
    result.current.refetch()
    await waitFor(() => expect(result.current.assignments).toEqual([]))
  })
})
