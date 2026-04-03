import { useState, useCallback, useEffect } from 'react'
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

  const fetchChores = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('chores')
      .select('*')
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
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
