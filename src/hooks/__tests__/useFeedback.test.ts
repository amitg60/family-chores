import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useFeedback } from '../useFeedback'

const fakeFeedback = {
  id: 'fb1',
  user_id: 'u1',
  family_id: 'f1',
  category: 'bug' as const,
  areas: ['chores'],
  star_rating: 4,
  mood: 'happy' as const,
  free_text: 'מעולה',
  noted: false,
  resolved: false,
  created_at: '2026-04-04T10:00:00Z',
  profiles: { name: 'דנה' },
}

function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

describe('useFeedback', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useFeedback())
    expect(result.current.loading).toBe(true)
    expect(result.current.feedback).toEqual([])
  })

  it('returns feedback with profile name', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeFeedback], error: null }))
    const { result } = renderHook(() => useFeedback())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.feedback).toEqual([fakeFeedback])
    expect(result.current.error).toBeNull()
  })

  it('sets error on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאה' } }))
    const { result } = renderHook(() => useFeedback())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאה')
    expect(result.current.feedback).toEqual([])
  })

  it('refetch re-queries', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeFeedback], error: null }))
    const { result } = renderHook(() => useFeedback())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mockFrom.mockReturnValue(makeFromMock({ data: [], error: null }))
    result.current.refetch()
    await waitFor(() => expect(result.current.feedback).toEqual([]))
  })
})
