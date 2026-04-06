import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Achievement, PlayerAchievement } from '../types/database'

export interface AchievementWithStatus extends Achievement {
  earned_at: string | null
  player_achievement_id: string | null
}

export interface UseAchievementsResult {
  achievements: AchievementWithStatus[]
  earnedIds: Set<string>
  totalCompletedAllTime: number
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useAchievements(userId: string | undefined): UseAchievementsResult {
  const [achievements, setAchievements] = useState<AchievementWithStatus[]>([])
  const [earnedIds, setEarnedIds] = useState<Set<string>>(new Set())
  const [totalCompletedAllTime, setTotalCompletedAllTime] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchAchievements = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    const [
      { data: allData, error: err1 },
      { data: earnedData, error: err2 },
      { count: totalCount, error: err3 },
    ] = await Promise.all([
      supabase.from('achievements').select('*').order('threshold', { ascending: true }),
      supabase.from('player_achievements').select('*').eq('user_id', userId),
      supabase.from('chore_assignments').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'completed'),
    ])

    if (!mountedRef.current) return

    if (err1 || err2 || err3) {
      setError((err1 ?? err2 ?? err3)?.message ?? 'Unknown error')
      setLoading(false)
      return
    }

    const earnedMap = new Map((earnedData ?? []).map((pa: PlayerAchievement) => [pa.achievement_id, pa]))
    setAchievements((allData ?? []).map((a: Achievement) => ({
      ...a,
      earned_at: earnedMap.get(a.id)?.earned_at ?? null,
      player_achievement_id: earnedMap.get(a.id)?.id ?? null,
    })))
    setEarnedIds(new Set((earnedData ?? []).map((pa: PlayerAchievement) => pa.achievement_id)))
    setTotalCompletedAllTime(totalCount ?? 0)
    setLoading(false)
  // supabase is a stable singleton — no external dependencies needed
  }, [userId])

  useEffect(() => { fetchAchievements() }, [fetchAchievements])

  return { achievements, earnedIds, totalCompletedAllTime, loading, error, refetch: fetchAchievements }
}
