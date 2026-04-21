import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { PenaltyPolicy } from '../types/database'

export interface UsePenaltyPolicyResult {
  policy: PenaltyPolicy | null
  loading: boolean
  error: string | null
  update: (dayDeduction: number, weekDeduction: number) => Promise<{ error: string | null }>
}

export function usePenaltyPolicy(): UsePenaltyPolicyResult {
  const { profile } = useAuth()
  const [policy, setPolicy] = useState<PenaltyPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPolicy = useCallback(async () => {
    if (!profile?.family_id) return
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('penalty_policy')
      .select('*')
      .eq('family_id', profile.family_id)
      .maybeSingle()
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setPolicy(data as PenaltyPolicy | null)
    }
    setLoading(false)
  }, [profile?.family_id])

  useEffect(() => {
    fetchPolicy()
  }, [fetchPolicy])

  async function update(dayDeduction: number, weekDeduction: number): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('update_penalty_policy', {
      p_day_deduction: dayDeduction,
      p_week_deduction: weekDeduction,
    })
    if (error) return { error: error.message }
    fetchPolicy()
    return { error: null }
  }

  return { policy, loading, error, update }
}
