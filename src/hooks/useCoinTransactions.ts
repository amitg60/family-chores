import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { CoinTransaction } from '../types/database'

export interface UseCoinTransactionsResult {
  transactions: CoinTransaction[]
  totalEarned: number
  totalSpent: number
  loading: boolean
  error: string | null
}

export function useCoinTransactions(userId: string | undefined): UseCoinTransactionsResult {
  const [transactions, setTransactions] = useState<CoinTransaction[]>([])
  const [totalEarned, setTotalEarned] = useState(0)
  const [totalSpent, setTotalSpent] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchTransactions = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    const [
      { data: recentData, error: err1 },
      { data: allData, error: err2 },
    ] = await Promise.all([
      supabase
        .from('coin_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('coin_transactions')
        .select('amount')
        .eq('user_id', userId),
    ])

    if (!mountedRef.current) return

    if (err1 || err2) {
      setError((err1 ?? err2)?.message ?? 'Unknown error')
      setLoading(false)
      return
    }

    setTransactions((recentData ?? []) as CoinTransaction[])

    const amounts = (allData ?? []) as { amount: number }[]
    setTotalEarned(amounts.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0))
    setTotalSpent(amounts.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0))
    setLoading(false)
  // supabase is a stable singleton — no external dependencies needed
  }, [userId])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  return { transactions, totalEarned, totalSpent, loading, error }
}
