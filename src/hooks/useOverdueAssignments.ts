import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { OverdueAssignmentWithDetails } from '../types/database'

export interface UseOverdueAssignmentsResult {
  assignments: OverdueAssignmentWithDetails[]
  loading: boolean
  error: string | null
  waive: (assignmentId: string) => Promise<{ error: string | null }>
  refetch: () => void
}

export function useOverdueAssignments(): UseOverdueAssignmentsResult {
  const [assignments, setAssignments] = useState<OverdueAssignmentWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchAssignments = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('chore_assignments')
      .select('id, chore_id, user_id, calendar_day, calendar_slot, penalty_waived, chores(title, coin_value), profiles!user_id(name, avatar_url)')
      .eq('status', 'overdue')
      .eq('penalty_waived', false)
      .eq('archived', false)
      .order('created_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setAssignments((data as OverdueAssignmentWithDetails[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAssignments()
  }, [fetchAssignments])

  async function waive(assignmentId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('waive_assignment_penalty', { p_assignment_id: assignmentId })
    if (error) return { error: error.message }
    fetchAssignments()
    return { error: null }
  }

  return { assignments, loading, error, waive, refetch: fetchAssignments }
}
