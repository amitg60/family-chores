import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

export interface ActivityItem {
  id: string
  profileName: string
  profileAvatar: string | null
  achievementIcon: string
  achievementTitle: string
  earnedAt: string
}

export interface UseActivityFeedResult {
  items: ActivityItem[]
  loading: boolean
  error: string | null
}

export function useActivityFeed(): UseActivityFeedResult {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchFeed = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('player_achievements')
      .select('id, earned_at, achievements!achievement_id(icon, title_he), profiles!user_id(name, avatar_url)')
      .order('earned_at', { ascending: false })
      .limit(20)
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setItems((data ?? []).map((row: Record<string, unknown>) => {
        const achievement = row.achievements as { icon: string; title_he: string }
        const profile = row.profiles as { name: string; avatar_url: string | null }
        return {
          id: row.id as string,
          profileName: profile.name,
          profileAvatar: profile.avatar_url,
          achievementIcon: achievement.icon,
          achievementTitle: achievement.title_he,
          earnedAt: row.earned_at as string,
        }
      }))
    }
    setLoading(false)
  // supabase is a stable singleton — no external dependencies needed
  }, [])

  useEffect(() => { fetchFeed() }, [fetchFeed])

  return { items, loading, error }
}
