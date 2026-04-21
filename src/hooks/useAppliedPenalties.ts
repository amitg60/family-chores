import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { AdminPenaltyRow } from '../types/database'

export interface UseAppliedPenaltiesResult {
  penalties: AdminPenaltyRow[]
  loading: boolean
  error: string | null
  reverse: (penaltyId: string) => Promise<{ error: string | null }>
  refetch: () => void
}

export function useAppliedPenalties(): UseAppliedPenaltiesResult {
  const [penalties, setPenalties] = useState<AdminPenaltyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPenalties = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('penalties')
      .select('*, chore_assignments(chore_id, chores(title)), profiles!user_id(name, avatar_url)')
      .order('applied_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setPenalties((data as AdminPenaltyRow[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPenalties()
  }, [fetchPenalties])

  async function reverse(penaltyId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('reverse_penalty', { p_penalty_id: penaltyId })
    if (error) return { error: error.message }
    fetchPenalties()
    return { error: null }
  }

  return { penalties, loading, error, reverse, refetch: fetchPenalties }
}
