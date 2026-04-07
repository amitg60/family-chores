import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentWeekStart } from '../lib/weekStart'

export interface LeaderboardEntry {
  userId: string
  name: string
  avatarUrl: string | null
  weeklyEarned: number
}

export interface UseAdminDashboardStatsResult {
  leaderboard: LeaderboardEntry[]
  totalCoinsThisWeek: number
  activeTradesCount: number
  loading: boolean
  error: string | null
}

type TxRow = {
  amount: number
  user_id: string
  profiles: { name: string; avatar_url: string | null }
}

export function useAdminDashboardStats(): UseAdminDashboardStatsResult {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [totalCoinsThisWeek, setTotalCoinsThisWeek] = useState(0)
  const [activeTradesCount, setActiveTradesCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    const weekStart = getCurrentWeekStart()

    const [
      { data: txData, error: txErr },
      { data: tradeData, error: tradeErr },
    ] = await Promise.all([
      supabase
        .from('coin_transactions')
        .select('amount, user_id, profiles!user_id(name, avatar_url)')
        .gte('created_at', weekStart)
        .gt('amount', 0),
      supabase
        .from('trade_offers')
        .select('id')
        .eq('status', 'pending'),
    ])

    if (!mountedRef.current) return

    if (txErr || tradeErr) {
      setError((txErr ?? tradeErr)?.message ?? 'Unknown error')
      setLoading(false)
      return
    }

    const rows = (txData ?? []) as unknown as TxRow[]
    const totals = new Map<string, LeaderboardEntry>()
    let weekTotal = 0

    for (const row of rows) {
      weekTotal += row.amount
      const entry = totals.get(row.user_id) ?? {
        userId: row.user_id,
        name: row.profiles?.name ?? '?',
        avatarUrl: row.profiles?.avatar_url ?? null,
        weeklyEarned: 0,
      }
      entry.weeklyEarned += row.amount
      totals.set(row.user_id, entry)
    }

    setLeaderboard([...totals.values()].sort((a, b) => b.weeklyEarned - a.weeklyEarned))
    setTotalCoinsThisWeek(weekTotal)
    setActiveTradesCount((tradeData ?? []).length)
    setLoading(false)
  // supabase and getCurrentWeekStart are stable singletons
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  return { leaderboard, totalCoinsThisWeek, activeTradesCount, loading, error }
}
