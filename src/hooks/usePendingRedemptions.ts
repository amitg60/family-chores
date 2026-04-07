import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

export interface RedemptionWithDetails {
  id: string
  reward_id: string
  redeemed_by: string
  coin_cost_at_time: number
  status: 'pending' | 'granted' | 'declined'
  redeemed_at: string
  resolved_at: string | null
  rewards: { title: string; coin_cost: number }
  profiles: { name: string }
}

export interface UsePendingRedemptionsResult {
  redemptions: RedemptionWithDetails[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function usePendingRedemptions(): UsePendingRedemptionsResult {
  const [redemptions, setRedemptions] = useState<RedemptionWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchRedemptions = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('reward_redemptions')
      .select(`
        id,
        reward_id,
        redeemed_by,
        coin_cost_at_time,
        status,
        redeemed_at,
        resolved_at,
        rewards!inner(title, coin_cost),
        profiles!redeemed_by(name)
      `)
      .eq('status', 'pending')
      .order('redeemed_at', { ascending: true })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setRedemptions((data as unknown as RedemptionWithDetails[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchRedemptions() }, [fetchRedemptions])

  return { redemptions, loading, error, refetch: fetchRedemptions }
}
