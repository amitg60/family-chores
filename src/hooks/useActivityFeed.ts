import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

interface PlayerAchievementRow {
  id: string
  earned_at: string
  achievements: { icon: string; title_he: string }
  profiles: { name: string; avatar_url: string | null }
}

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
  refetch: () => void
}

export function useActivityFeed(familyId: string | null): UseActivityFeedResult {
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
    // RLS on player_achievements restricts results to the current family
    const { data, error } = await supabase
      .from('player_achievements')
      .select('id, earned_at, achievements!achievement_id(icon, title_he), profiles!user_id(name, avatar_url)')
      .order('earned_at', { ascending: false })
      .limit(20)
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setItems(((data ?? []) as unknown as PlayerAchievementRow[]).map((row) => ({
        id: row.id,
        profileName: row.profiles.name,
        profileAvatar: row.profiles.avatar_url,
        achievementIcon: row.achievements.icon,
        achievementTitle: row.achievements.title_he,
        earnedAt: row.earned_at,
      })))
    }
    setLoading(false)
  // supabase is a stable singleton — no external dependencies needed
  }, [])

  useEffect(() => { fetchFeed() }, [fetchFeed])

  useEffect(() => {
    if (!familyId) return
    const channel = supabase
      .channel(`activity-feed-${familyId}`)
      // No familyId filter: player_achievements has no family_id column.
      // RLS on the refetch query handles family scoping.
      .on('postgres_changes' as const, {
        event: 'INSERT', schema: 'public', table: 'player_achievements',
      }, () => { if (mountedRef.current) fetchFeed() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [familyId, fetchFeed])

  return { items, loading, error, refetch: fetchFeed }
}
