import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentWeekStart } from '../lib/weekStart'

const STORAGE_KEY = 'weeklyPopulated'

export function useWeeklyPopulation(): void {
  const { profile } = useAuth()

  useEffect(() => {
    if (!profile?.family_id) return
    const currentWeek = getCurrentWeekStart()
    if (localStorage.getItem(STORAGE_KEY) === currentWeek) return
    supabase
      .rpc('populate_weekly_assignments', { p_week_start: currentWeek })
      .then(() => localStorage.setItem(STORAGE_KEY, currentWeek))
      .catch(err => console.error('[useWeeklyPopulation]', err))
  }, [profile?.family_id])
}
