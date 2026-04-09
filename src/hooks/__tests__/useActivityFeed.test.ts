import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockChannel } from '../../test/mocks/supabase'
import { useActivityFeed } from '../useActivityFeed'

const fakeRow = {
  id: 'pa1',
  earned_at: '2026-04-05T10:00:00Z',
  achievements: { icon: '🏆', title_he: 'משימה ראשונה' },
  profiles: { name: 'דנה', avatar_url: null },
}

function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  }
}

describe('useActivityFeed', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useActivityFeed(null))
    expect(result.current.loading).toBe(true)
    expect(result.current.items).toEqual([])
  })

  it('returns mapped activity items', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeRow], error: null }))
    const { result } = renderHook(() => useActivityFeed(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({
      id: 'pa1',
      profileName: 'דנה',
      achievementIcon: '🏆',
      achievementTitle: 'משימה ראשונה',
      earnedAt: '2026-04-05T10:00:00Z',
    })
    expect(result.current.error).toBeNull()
  })

  it('sets error on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאה' } }))
    const { result } = renderHook(() => useActivityFeed(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאה')
    expect(result.current.items).toEqual([])
  })

  it('does not subscribe to realtime when familyId is null', () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [], error: null }))
    renderHook(() => useActivityFeed(null))
    expect(mockChannel).not.toHaveBeenCalled()
  })

  it('refetches when a realtime INSERT event fires', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeRow], error: null }))
    const { result } = renderHook(() => useActivityFeed('family-123'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFrom).toHaveBeenCalledTimes(1)

    const channelObj = mockChannel.mock.results[0].value
    const realtimeCallback = channelObj.on.mock.calls[0][2]
    act(() => { realtimeCallback({}) })

    await waitFor(() => expect(mockFrom).toHaveBeenCalledTimes(2))
  })
})
