import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentWeekStart } from '../lib/weekStart'
import type { ChoreAssignment } from '../types/database'

export interface UseChoreAssignmentsResult {
  assignments: ChoreAssignment[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useChoreAssignments(userId: string | undefined): UseChoreAssignmentsResult {
  const [assignments, setAssignments] = useState<ChoreAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchAssignments = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const weekStart = getCurrentWeekStart()
    const { data, error } = await supabase
      .from('chore_assignments')
      .select('*, chore_completions(status)')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .eq('archived', false)
      .order('created_at', { ascending: true })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      const assignments = ((data ?? []) as (ChoreAssignment & { chore_completions: { status: string }[] })[]).map(
        ({ chore_completions, ...a }) => ({
          ...a,
          hasRejection: chore_completions?.some(c => c.status === 'rejected') ?? false,
        })
      )
      setAssignments(assignments as ChoreAssignment[])
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { fetchAssignments() }, [fetchAssignments])

  return { assignments, loading, error, refetch: fetchAssignments }
}
