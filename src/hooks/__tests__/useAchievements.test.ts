import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useAchievements } from '../useAchievements'
import type { Achievement, PlayerAchievement } from '../../types/database'

const fakeAchievement: Achievement = {
  id: 'ach1',
  key: 'first_chore',
  title_he: 'משימה ראשונה',
  description_he: 'השלמת את המשימה הראשונה שלך!',
  icon: '🏆',
  trigger_type: 'chore_count',
  threshold: 1,
  created_at: '2026-04-01T00:00:00Z',
}

const fakePlayerAchievement: PlayerAchievement = {
  id: 'pa1',
  user_id: 'u1',
  achievement_id: 'ach1',
  earned_at: '2026-04-05T10:00:00Z',
}

function setupMocks(
  allAchievements: Achievement[],
  playerAchievements: PlayerAchievement[],
  count: number,
  err1: null | { message: string } = null,
  err2: null | { message: string } = null,
  err3: null | { message: string } = null,
) {
  mockFrom
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: err1 ? null : allAchievements, error: err1 }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: err2 ? null : playerAchievements, error: err2 }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ count: err3 ? null : count, data: null, error: err3 }),
      }),
    })
}

describe('useAchievements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom
      .mockReturnValueOnce({ select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnValue(new Promise(() => {})) })
      .mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue(new Promise(() => {})) })
      .mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue(new Promise(() => {})) }) })
    const { result } = renderHook(() => useAchievements('u1'))
    expect(result.current.loading).toBe(true)
    expect(result.current.achievements).toEqual([])
  })

  it('returns merged achievements with earned status', async () => {
    setupMocks([fakeAchievement], [fakePlayerAchievement], 3)
    const { result } = renderHook(() => useAchievements('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.achievements).toHaveLength(1)
    expect(result.current.achievements[0].earned_at).toBe('2026-04-05T10:00:00Z')
    expect(result.current.achievements[0].player_achievement_id).toBe('pa1')
    expect(result.current.error).toBeNull()
  })

  it('sets earnedIds and totalCompletedAllTime', async () => {
    setupMocks([fakeAchievement], [fakePlayerAchievement], 5)
    const { result } = renderHook(() => useAchievements('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.earnedIds.has('ach1')).toBe(true)
    expect(result.current.totalCompletedAllTime).toBe(5)
  })

  it('sets error when any query fails', async () => {
    setupMocks([], [], 0, { message: 'DB down' })
    const { result } = renderHook(() => useAchievements('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB down')
  })

  it('returns empty results when userId is undefined', async () => {
    const { result } = renderHook(() => useAchievements(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.achievements).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
