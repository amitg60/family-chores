import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Reward } from '../types/database'

interface UseRewardsResult {
  rewards: Reward[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useRewards(): UseRewardsResult {
  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // supabase is a stable singleton — no external dependencies needed
  const fetchRewards = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('rewards')
      .select('*')
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setRewards((data as Reward[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchRewards()
  }, [fetchRewards])

  return { rewards, loading, error, refetch: fetchRewards }
}
