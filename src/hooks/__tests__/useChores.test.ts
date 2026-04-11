import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useChores } from '../useChores'

const fakeChore = {
  id: 'c1',
  family_id: 'f1',
  title: 'כלי מטבח',
  description: null,
  coin_value: 10,
  difficulty: 'easy' as const,
  assigned_to: null,
  recurrence_type: 'none' as const,
  status: 'active' as const,
  proposed_by: null,
  approved_by: null,
  due_date: null,
  last_traded_price: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

describe('useChores', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useChores())
    expect(result.current.loading).toBe(true)
    expect(result.current.chores).toEqual([])
  })

  it('returns chores after successful fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeChore], error: null }))
    const { result } = renderHook(() => useChores())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.chores).toEqual([fakeChore])
    expect(result.current.error).toBeNull()
  })

  it('sets error message on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאת שרת' } }))
    const { result } = renderHook(() => useChores())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאת שרת')
    expect(result.current.chores).toEqual([])
  })

  it('refetch re-queries and updates chores', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeChore], error: null }))
    const { result } = renderHook(() => useChores())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const updatedChore = { ...fakeChore, title: 'כיבוי אורות' }
    mockFrom.mockReturnValue(makeFromMock({ data: [updatedChore], error: null }))
    result.current.refetch()

    await waitFor(() => expect(result.current.chores[0].title).toBe('כיבוי אורות'))
  })

  it('excludes both archived and deleted chores from query', async () => {
    const mock = makeFromMock({ data: [], error: null })
    mockFrom.mockReturnValue(mock)
    renderHook(() => useChores())
    await waitFor(() => expect(mock.order).toHaveBeenCalled())
    expect(mock.neq).toHaveBeenCalledWith('status', 'archived')
    expect(mock.neq).toHaveBeenCalledWith('status', 'deleted')
  })
})
