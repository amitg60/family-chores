import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

export interface ApprovalRateResult {
  approved: number
  rejected: number
  total: number
  rate: number | null
  loading: boolean
  error: string | null
}

export function useApprovalRate(): ApprovalRateResult {
  const [approved, setApproved] = useState(0)
  const [rejected, setRejected] = useState(0)
  const [total, setTotal] = useState(0)
  const [rate, setRate] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchRate = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('get_my_approval_rate')
    if (!mountedRef.current) return
    if (rpcError) {
      setError(rpcError.message)
    } else {
      const row = (data as { approved: number; rejected: number; total: number; rate: number | null }[] | null)?.[0]
      setApproved(row?.approved ?? 0)
      setRejected(row?.rejected ?? 0)
      setTotal(row?.total ?? 0)
      setRate(row?.rate ?? null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchRate() }, [fetchRate])

  return { approved, rejected, total, rate, loading, error }
}
