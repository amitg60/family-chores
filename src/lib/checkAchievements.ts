import { supabase } from './supabase'
import type { AchievementWithStatus } from '../hooks/useAchievements'

export interface CheckAchievementsParams {
  userId: string
  coinBalance: number
  completedThisWeek: number
  totalCompletedAllTime: number
  earnedIds: Set<string>
  achievements: AchievementWithStatus[]
}

export async function checkAndAwardAchievements(params: CheckAchievementsParams): Promise<string[]> {
  const unearned = params.achievements.filter(a => !params.earnedIds.has(a.id))
  const toAward: AchievementWithStatus[] = []

  for (const a of unearned) {
    let shouldAward = false
    if (a.trigger_type === 'chore_count') {
      if (a.key === 'first_chore') shouldAward = params.totalCompletedAllTime >= a.threshold
      else if (a.key === 'five_chores_week') shouldAward = params.completedThisWeek >= a.threshold
    } else if (a.trigger_type === 'coin_total') {
      shouldAward = params.coinBalance >= a.threshold
    }
    if (shouldAward) toAward.push(a)
  }

  const newlyEarned: string[] = []
  for (const a of toAward) {
    const { error } = await supabase.from('player_achievements').insert({
      user_id: params.userId,
      achievement_id: a.id,
    })
    if (error) {
      // 23505 = unique_violation (already earned) — silently skip
      if ((error as { code?: string }).code !== '23505') {
        console.error('[checkAndAwardAchievements] unexpected insert error', error)
      }
    } else {
      newlyEarned.push(a.key)
    }
  }

  return newlyEarned
}
