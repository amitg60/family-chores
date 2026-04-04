import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Feedback } from '../types/database'

export interface FeedbackWithProfile extends Feedback {
  profiles: { name: string }
}

export interface UseFeedbackResult {
  feedback: FeedbackWithProfile[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFeedback(): UseFeedbackResult {
  const [feedback, setFeedback] = useState<FeedbackWithProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchFeedback = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('feedback')
      .select('*, profiles!user_id(name)')
      .order('created_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setFeedback((data as FeedbackWithProfile[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchFeedback() }, [fetchFeedback])

  return { feedback, loading, error, refetch: fetchFeedback }
}
