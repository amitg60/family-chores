import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { PenaltyWithChore } from '../types/database'

export interface UsePenaltiesResult {
  penalties: PenaltyWithChore[]
  loading: boolean
  error: string | null
}

export function usePenalties(): UsePenaltiesResult {
  const [penalties, setPenalties] = useState<PenaltyWithChore[]>([])
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
      .select('*, chore_assignments(chore_id, chores(title))')
      .order('applied_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setPenalties((data as PenaltyWithChore[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPenalties()
  }, [fetchPenalties])

  return { penalties, loading, error }
}
