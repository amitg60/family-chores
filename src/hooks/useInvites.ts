import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { FamilyInvite, UserRole } from '../types/database'

interface UseInvitesResult {
  invites: FamilyInvite[]
  loading: boolean
  refetch: () => void
  cancelInvite: (id: string) => Promise<void>
  generateInvite: (role: UserRole) => Promise<string>
}

export function useInvites(): UseInvitesResult {
  const { profile } = useAuth()
  const [invites, setInvites] = useState<FamilyInvite[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchInvites = useCallback(async () => {
    if (!profile?.family_id) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('family_invites')
      .select('*')
      .eq('family_id', profile.family_id)
      .is('used_at', null)
      .order('created_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) console.error('Failed to fetch invites:', error.message)
    const now = new Date()
    const active = ((data as FamilyInvite[]) ?? []).filter(
      inv => new Date(inv.expires_at) > now
    )
    setInvites(active)
    setLoading(false)
  }, [profile?.family_id])

  useEffect(() => { fetchInvites() }, [fetchInvites])

  const cancelInvite = useCallback(async (id: string) => {
    const { error } = await supabase.from('family_invites').delete().eq('id', id)
    if (error) { console.error('Failed to cancel invite:', error.message); return }
    if (mountedRef.current) setInvites(prev => prev.filter(inv => inv.id !== id))
  }, [])

  const generateInvite = useCallback(async (role: UserRole): Promise<string> => {
    const { data, error } = await supabase.rpc('generate_invite_token', { p_role: role })
    if (error) throw new Error(error.message)
    return data as string
  }, [])

  return { invites, loading, refetch: fetchInvites, cancelInvite, generateInvite }
}
