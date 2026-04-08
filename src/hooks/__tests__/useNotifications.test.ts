import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockChannel, mockRemoveChannel } from '../../test/mocks/supabase'
import type { Notification } from '../../types/database'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'user1', family_id: 'fam1', name: 'Test',
      avatar_url: null, role: 'player' as const, trust_level: 1,
      coin_balance: 0, created_at: '', updated_at: '',
    },
  }),
}))

const n1: Notification = {
  id: 'n1', user_id: 'user1', family_id: 'fam1',
  type: 'chore_assigned', title_he: 'הוקצתה לך משימה חדשה',
  body_he: 'משימה', related_entity_id: null, read: false,
  created_at: '2026-04-08T10:00:00Z',
}
const n2: Notification = {
  id: 'n2', user_id: 'user1', family_id: 'fam1',
  type: 'achievement_earned', title_he: 'זכית בהישג חדש!',
  body_he: '🏆 משימה ראשונה', related_entity_id: null, read: false,
  created_at: '2026-04-08T09:00:00Z',
}

function setupFetchMock(rows: Notification[], error: { message: string } | null = null) {
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: error ? null : rows, error }),
  })
}

// Import after mocks are set up
import { useNotifications } from '../useNotifications'

describe('useNotifications', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useNotifications())
    expect(result.current.loading).toBe(true)
    expect(result.current.notifications).toEqual([])
    expect(result.current.unreadCount).toBe(0)
  })

  it('fetches unread notifications on mount and derives unreadCount', async () => {
    setupFetchMock([n1, n2])
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.notifications).toEqual([n1, n2])
    expect(result.current.unreadCount).toBe(2)
  })

  it('prepends new notification when realtime INSERT arrives', async () => {
    setupFetchMock([n1])
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const channelObj = mockChannel.mock.results[0].value
    const realtimeCallback = channelObj.on.mock.calls[0][2]

    act(() => realtimeCallback({ new: n2 }))

    expect(result.current.notifications[0]).toEqual(n2)
    expect(result.current.notifications[1]).toEqual(n1)
    expect(result.current.unreadCount).toBe(2)
  })

  it('markRead removes notification from list', async () => {
    setupFetchMock([n1, n2])
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockFrom.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    await act(async () => {
      await result.current.markRead('n1')
    })

    expect(result.current.notifications).toEqual([n2])
    expect(result.current.unreadCount).toBe(1)
  })

  it('markAllRead clears the notification list', async () => {
    setupFetchMock([n1, n2])
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const secondEq = vi.fn().mockResolvedValue({ error: null })
    const firstEq  = vi.fn().mockReturnValue({ eq: secondEq })
    mockFrom.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({ eq: firstEq }),
    })

    await act(async () => {
      await result.current.markAllRead()
    })

    expect(result.current.notifications).toEqual([])
    expect(result.current.unreadCount).toBe(0)
  })

  it('cleans up realtime channel on unmount', async () => {
    setupFetchMock([])
    const { unmount } = renderHook(() => useNotifications())
    await waitFor(() => expect(mockChannel).toHaveBeenCalled())
    unmount()
    expect(mockRemoveChannel).toHaveBeenCalled()
  })
})
