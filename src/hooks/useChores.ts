import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Chore } from '../types/database'

interface UseChoresResult {
  chores: Chore[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useChores(): UseChoresResult {
  const [chores, setChores] = useState<Chore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // supabase is a stable singleton — no external dependencies needed
  const fetchChores = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('chores')
      .select('*')
      .neq('status', 'archived')
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setChores((data as Chore[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchChores()
  }, [fetchChores])

  return { chores, loading, error, refetch: fetchChores }
}
