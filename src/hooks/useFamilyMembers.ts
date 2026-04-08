import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

interface UseFamilyMembersResult {
  members: Profile[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFamilyMembers(): UseFamilyMembersResult {
  const [members, setMembers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('name')
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setMembers((data as Profile[]) ?? [])
    }
    setLoading(false)
  // supabase is a stable singleton — no external dependencies needed
  }, [])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  return { members, loading, error, refetch: fetchMembers }
}
