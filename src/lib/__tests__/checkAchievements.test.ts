import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { checkAndAwardAchievements } from '../checkAchievements'
import type { AchievementWithStatus } from '../../hooks/useAchievements'

const makeAchievement = (overrides: Partial<AchievementWithStatus>): AchievementWithStatus => ({
  id: 'ach1',
  key: 'first_chore',
  title_he: 'משימה ראשונה',
  description_he: 'השלמת את המשימה הראשונה שלך!',
  icon: '🏆',
  trigger_type: 'chore_count',
  threshold: 1,
  created_at: '2026-04-01T00:00:00Z',
  earned_at: null,
  player_achievement_id: null,
  ...overrides,
})

const baseParams = {
  userId: 'u1',
  coinBalance: 10,
  completedThisWeek: 0,
  totalCompletedAllTime: 0,
  earnedIds: new Set<string>(),
}

describe('checkAndAwardAchievements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('awards first_chore when totalCompletedAllTime >= threshold', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ insert: insertMock })
    const result = await checkAndAwardAchievements({
      ...baseParams,
      totalCompletedAllTime: 1,
      achievements: [makeAchievement({ id: 'ach1', key: 'first_chore', trigger_type: 'chore_count', threshold: 1 })],
    })
    expect(result).toEqual(['first_chore'])
    expect(mockFrom).toHaveBeenCalledWith('player_achievements')
    expect(insertMock).toHaveBeenCalledWith({ user_id: 'u1', achievement_id: 'ach1' })
  })

  it('awards five_chores_week when completedThisWeek >= threshold', async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    const result = await checkAndAwardAchievements({
      ...baseParams,
      completedThisWeek: 5,
      achievements: [makeAchievement({ key: 'five_chores_week', trigger_type: 'chore_count', threshold: 5 })],
    })
    expect(result).toEqual(['five_chores_week'])
  })

  it('awards hundred_coins when coinBalance >= threshold', async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    const result = await checkAndAwardAchievements({
      ...baseParams,
      coinBalance: 150,
      achievements: [makeAchievement({ key: 'hundred_coins', trigger_type: 'coin_total', threshold: 100 })],
    })
    expect(result).toEqual(['hundred_coins'])
  })

  it('does not award already-earned achievements', async () => {
    const result = await checkAndAwardAchievements({
      ...baseParams,
      totalCompletedAllTime: 1,
      earnedIds: new Set(['ach1']),
      achievements: [makeAchievement({ id: 'ach1', key: 'first_chore', trigger_type: 'chore_count', threshold: 1 })],
    })
    expect(result).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns empty array when threshold not met', async () => {
    const result = await checkAndAwardAchievements({
      ...baseParams,
      totalCompletedAllTime: 0,
      achievements: [makeAchievement({ key: 'first_chore', trigger_type: 'chore_count', threshold: 1 })],
    })
    expect(result).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('silently skips insert-failed achievements', async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: 'unique violation' } }) })
    const result = await checkAndAwardAchievements({
      ...baseParams,
      totalCompletedAllTime: 1,
      achievements: [makeAchievement({ key: 'first_chore', trigger_type: 'chore_count', threshold: 1 })],
    })
    expect(result).toEqual([])
  })
})
