import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentWeekStart } from '../lib/weekStart'
import type { ChoreAssignment } from '../types/database'

export interface AssignmentWithDetails extends ChoreAssignment {
  chores: { title: string; coin_value: number; recurrence_type: string }
  profiles: { name: string; avatar_url: string | null }
}

export interface UseCalendarAssignmentsResult {
  assignments: AssignmentWithDetails[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useCalendarAssignments(): UseCalendarAssignmentsResult {
  const [assignments, setAssignments] = useState<AssignmentWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const initialLoadDone = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchAssignments = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    setError(null)
    const weekStart = getCurrentWeekStart()
    const { data, error } = await supabase
      .from('chore_assignments')
      .select('*, chores!inner(title, coin_value, recurrence_type), profiles!user_id(name, avatar_url)')
      .eq('week_start', weekStart)
      .eq('archived', false)
      .neq('status', 'completed')
      .order('created_at', { ascending: true })
    if (!mountedRef.current) return
    if (error) {
      console.log('[calendar] fetch error:', error)
      setError(error.message)
    } else {
      console.log('[calendar] fetched', data?.length, 'assignments, week_start=', weekStart, data)
      setAssignments((data as AssignmentWithDetails[]) ?? [])
    }
    // Temp debug: all rows for chore 39e7bdd6 across ALL weeks to find hidden conflict
    const { data: raw, error: rawErr } = await supabase
      .from('chore_assignments')
      .select('id, chore_id, user_id, week_start, calendar_day, calendar_slot, status, archived')
      .eq('chore_id', '39e7bdd6-3ac4-4980-af6e-5a3b2f41bc15')
    console.log('[calendar] raw ALL-weeks for chore 39e7bdd6:', rawErr ?? raw)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true
      fetchAssignments(true)
    }
  }, [fetchAssignments])

  return { assignments, loading, error, refetch: () => fetchAssignments(false) }
}
