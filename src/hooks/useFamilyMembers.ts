import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

interface UseFamilyMembersResult {
  members: Profile[]
  loading: boolean
}

export function useFamilyMembers(): UseFamilyMembersResult {
  const [members, setMembers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('name')
      .then(({ data }) => {
        setMembers((data as Profile[]) ?? [])
        setLoading(false)
      })
  }, [])

  return { members, loading }
}
