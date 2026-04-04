import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

export interface CompletionWithDetails {
  id: string
  chore_assignment_id: string
  completed_by: string
  photo_url: string | null
  status: 'pending' | 'approved' | 'rejected'
  completed_at: string
  chore_assignments: {
    chore_id: string
    chores: { title: string; coin_value: number }
  }
  profiles: { name: string }
}

export interface UsePendingCompletionsResult {
  completions: CompletionWithDetails[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function usePendingCompletions(): UsePendingCompletionsResult {
  const [completions, setCompletions] = useState<CompletionWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchCompletions = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('chore_completions')
      .select(`
        id,
        chore_assignment_id,
        completed_by,
        photo_url,
        status,
        completed_at,
        chore_assignments!inner(chore_id, chores!inner(title, coin_value)),
        profiles!completed_by(name)
      `)
      .eq('status', 'pending')
      .order('completed_at', { ascending: true })
    if (!mountedRef.current) return
    if (error) { setError(error.message) } else { setCompletions((data as CompletionWithDetails[]) ?? []) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchCompletions() }, [fetchCompletions])

  return { completions, loading, error, refetch: fetchCompletions }
}
