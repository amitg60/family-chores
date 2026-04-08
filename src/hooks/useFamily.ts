import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Family } from '../types/database'

interface UseFamilyResult {
  family: Family | null
  loading: boolean
}

export function useFamily(): UseFamilyResult {
  const { profile } = useAuth()
  const [family, setFamily] = useState<Family | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchFamily = useCallback(async () => {
    if (!profile?.family_id) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('families')
      .select('*')
      .eq('id', profile.family_id)
      .single()
    if (!mountedRef.current) return
    if (error) console.error('Failed to fetch family:', error.message)
    setFamily((data as Family) ?? null)
    setLoading(false)
  }, [profile?.family_id])

  useEffect(() => { fetchFamily() }, [fetchFamily])

  return { family, loading }
}
