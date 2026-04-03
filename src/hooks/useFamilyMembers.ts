import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

interface UseFamilyMembersResult {
  members: Profile[]
  loading: boolean
  error: string | null
}

export function useFamilyMembers(): UseFamilyMembersResult {
  const [members, setMembers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('profiles')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setError(error.message)
        } else {
          setMembers((data as Profile[]) ?? [])
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return { members, loading, error }
}
