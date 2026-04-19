import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useChores } from '../../../hooks/useChores'
import { useChoreAssignments } from '../../../hooks/useChoreAssignments'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent } from '../../../components/ui/card'
import { assignmentErrorMessage } from '../../../lib/assignmentErrors'
import type { ChoreDifficulty } from '../../../types/database'

const difficultyLabel: Record<ChoreDifficulty, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
}

export default function ChorePoolPage() {
  const { profile } = useAuth()
  const { chores, loading: choresLoading, refetch } = useChores()
  const { assignments } = useChoreAssignments(profile?.id)
  const navigate = useNavigate()

  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Non-recurring chores the player already holds — hide them from the pool
  const nonRecurringAssignedIds = new Set(
    assignments
      .filter(a => {
        const chore = chores.find(c => c.id === a.chore_id)
        return chore?.recurrence_type === 'none'
      })
      .map(a => a.chore_id)
  )

  const poolChores = chores.filter(c => {
    if (c.status !== 'active' || !c.is_pool_visible) return false
    if (c.recurrence_type === 'none') return !nonRecurringAssignedIds.has(c.id)
    return true
  })

  async function handleAssign(choreId: string, recurrenceType: string) {
    setAssigningId(choreId)
    setError(null)

    const { data, error: fnError } = await supabase.functions.invoke('self-assign-chore', {
      body: { chore_id: choreId, calendar_day: null, calendar_slot: null },
    })

    setAssigningId(null)

    if (fnError || !data?.ok) {
      console.log('[chore-assign] fnError:', fnError, 'data:', data)
      let code = 'INTERNAL_ERROR'
      let debugInfo = ''
      if (fnError?.context) {
        try {
          const body = await fnError.context.json()
          console.log('[chore-assign] error body:', body)
          code = body.error ?? 'INTERNAL_ERROR'
          debugInfo = body._debug ?? ''
        } catch (e) { console.log('[chore-assign] context.json() failed:', e) }
      }
      setError(debugInfo ? `[debug] ${debugInfo}` : assignmentErrorMessage(code))
      return
    }
    console.log('[chore-assign] success, data:', data)

    if (recurrenceType === 'none') {
      navigate('/player')
    } else {
      refetch()
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/player">← חזרה</Link>
        </Button>
        <h1 className="text-2xl font-bold">בחר משימה</h1>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {choresLoading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : poolChores.length === 0 ? (
        <p className="text-muted-foreground">אין משימות זמינות כרגע.</p>
      ) : (
        <div className="space-y-3">
          {poolChores.map(chore => (
            <Card key={chore.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{chore.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground">{chore.coin_value} מטבעות</span>
                    <Badge variant="secondary">{difficultyLabel[chore.difficulty]}</Badge>
                    {chore.recurrence_type !== 'none' && (
                      <Badge variant="outline" className="text-xs">🔁</Badge>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={assigningId === chore.id}
                  onClick={() => handleAssign(chore.id, chore.recurrence_type)}
                  aria-label={`בחר ${chore.title}`}
                >
                  {assigningId === chore.id ? '...' : 'קח משימה'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
