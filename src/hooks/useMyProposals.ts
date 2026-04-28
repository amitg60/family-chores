import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Chore, Reward } from '../types/database'

export function useMyProposals(
  table: 'chores',
  userId: string | undefined,
  familyId: string | undefined,
): { proposals: Chore[]; refetch: () => void }
export function useMyProposals(
  table: 'rewards',
  userId: string | undefined,
  familyId: string | undefined,
): { proposals: Reward[]; refetch: () => void }
export function useMyProposals(
  table: 'chores' | 'rewards',
  userId: string | undefined,
  familyId: string | undefined,
) {
  const [proposals, setProposals] = useState<(Chore | Reward)[]>([])

  const fetch = useCallback(async () => {
    if (!userId || !familyId) return
    const { data } = await supabase
      .from(table)
      .select('*')
      .eq('proposed_by', userId)
      .eq('family_id', familyId)
      .in('status', ['pending_approval', 'archived'])
      .order('created_at', { ascending: false })
    setProposals(data ?? [])
  }, [table, userId, familyId])

  useEffect(() => { fetch() }, [fetch])

  return { proposals, refetch: fetch }
}
