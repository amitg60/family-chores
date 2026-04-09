import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentWeekStart } from '../lib/weekStart'

const STORAGE_KEY = 'weeklyPopulated'

export function useWeeklyPopulation(): void {
  const { profile } = useAuth()
  const inFlight = useRef(false)

  useEffect(() => {
    if (!profile?.family_id) return
    const currentWeek = getCurrentWeekStart()
    if (localStorage.getItem(STORAGE_KEY) === currentWeek) return
    if (inFlight.current) return
    let cancelled = false
    inFlight.current = true
    supabase
      .rpc('populate_weekly_assignments', { p_week_start: currentWeek })
      .then(() => { if (!cancelled) localStorage.setItem(STORAGE_KEY, currentWeek) })
      .catch(err => console.error('[useWeeklyPopulation]', err))
      .finally(() => { inFlight.current = false })
    return () => { cancelled = true }
  }, [profile?.family_id])
}
