import { useState, useEffect, useCallback, useRef } from 'react'
import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Notification } from '../types/database'

interface UseNotificationsResult {
  notifications: Notification[]
  unreadCount: number
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  loading: boolean
}

export function useNotifications(): UseNotificationsResult {
  const { profile } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (!profile?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(50)
    if (!mountedRef.current) return
    setNotifications((data as Notification[]) ?? [])
    setLoading(false)
  }, [profile?.id])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase
      .channel(`notifications-${profile.id}`)
      .on(
        'postgres_changes' as const,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload: RealtimePostgresInsertPayload<Notification>) => {
          if (!mountedRef.current) return
          setNotifications(prev => [payload.new as Notification, ...prev])
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id])

  const markRead = useCallback(async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    if (mountedRef.current) {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }
  }, [])

  const markAllRead = useCallback(async () => {
    if (!profile?.id) return
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', profile.id)
      .eq('read', false)
    if (mountedRef.current) {
      setNotifications([])
    }
  }, [profile?.id])

  return {
    notifications,
    unreadCount: notifications.length,
    markRead,
    markAllRead,
    loading,
  }
}
