import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { FamilyAliasProposal, FamilyAliasVote } from '../types/database'

interface UseAliasVoteResult {
  proposal: FamilyAliasProposal | null
  votes: FamilyAliasVote[]
  castVote: (vote: boolean) => Promise<void>
  resolveIfExpired: () => Promise<void>
  loading: boolean
}

export function useAliasVote(): UseAliasVoteResult {
  const { profile } = useAuth()
  const [proposal, setProposal] = useState<FamilyAliasProposal | null>(null)
  const [votes, setVotes]       = useState<FamilyAliasVote[]>([])
  const [loading, setLoading]   = useState(true)
  const mountedRef               = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchProposal = useCallback(async () => {
    if (!profile?.family_id) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('family_alias_proposals')
      .select('*')
      .eq('family_id', profile.family_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!mountedRef.current) return
    if (error) console.error('Failed to fetch alias proposal:', error.message)
    const active = data as FamilyAliasProposal | null
    setProposal(active)

    if (active) {
      const { data: votesData, error: votesError } = await supabase
        .from('family_alias_votes')
        .select('*')
        .eq('proposal_id', active.id)
      if (!mountedRef.current) return
      if (votesError) console.error('Failed to fetch alias votes:', votesError.message)
      setVotes((votesData as FamilyAliasVote[]) ?? [])
    } else {
      setVotes([])
    }
    setLoading(false)
  }, [profile?.family_id])

  useEffect(() => { fetchProposal() }, [fetchProposal])

  useEffect(() => {
    if (!profile?.family_id) return
    const channel = supabase
      .channel(`alias-vote-${profile.family_id}`)
      .on('postgres_changes' as const, {
        event: '*', schema: 'public', table: 'family_alias_proposals',
        filter: `family_id=eq.${profile.family_id}`,
      }, () => { fetchProposal() })
      .on('postgres_changes' as const, {
        event: '*', schema: 'public', table: 'family_alias_votes',
      }, () => { fetchProposal() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.family_id, fetchProposal])

  // Poll every minute to trigger resolve when timer expires
  useEffect(() => {
    if (!proposal) return
    const interval = setInterval(() => {
      if (new Date(proposal.expires_at) < new Date()) {
        resolveIfExpired()
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [proposal?.expires_at])  // eslint-disable-line react-hooks/exhaustive-deps

  const castVote = useCallback(async (vote: boolean) => {
    if (!proposal) return
    const { error } = await supabase.rpc('cast_alias_vote', {
      p_proposal_id: proposal.id,
      p_vote: vote,
    })
    if (error) throw new Error(error.message)
  }, [proposal?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const resolveIfExpired = useCallback(async () => {
    if (!proposal) return
    const { error } = await supabase.rpc('resolve_alias_proposal', {
      p_proposal_id: proposal.id,
    })
    if (error) console.error('Failed to resolve alias proposal:', error.message)
  }, [proposal?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  return { proposal, votes, castVote, resolveIfExpired, loading }
}
