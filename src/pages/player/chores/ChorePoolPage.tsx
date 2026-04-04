import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useChores } from '../../../hooks/useChores'
import { useChoreAssignments } from '../../../hooks/useChoreAssignments'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { getCurrentWeekStart } from '../../../lib/weekStart'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent } from '../../../components/ui/card'
import type { ChoreDifficulty } from '../../../types/database'

const difficultyLabel: Record<ChoreDifficulty, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
}

export default function ChorePoolPage() {
  const { profile } = useAuth()
  const { chores, loading: choresLoading } = useChores()
  const { assignments } = useChoreAssignments(profile?.id)
  const navigate = useNavigate()
  const [pickingId, setPickingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const assignedChoreIds = new Set(assignments.map(a => a.chore_id))
  const poolChores = chores.filter(
    c => c.status === 'active' && c.assigned_to === null && !assignedChoreIds.has(c.id)
  )

  async function pickUpChore(choreId: string) {
    if (!profile) return
    setPickingId(choreId)
    setError(null)
    const { error } = await supabase.from('chore_assignments').insert({
      chore_id: choreId,
      user_id: profile.id,
      week_start: getCurrentWeekStart(),
      status: 'pending',
      archived: false,
      reminder_enabled: false,
    })
    setPickingId(null)
    if (error) { setError('שגיאה בבחירת המשימה') } else { navigate('/player') }
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
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={pickingId === chore.id}
                  onClick={() => pickUpChore(chore.id)}
                >
                  {pickingId === chore.id ? 'שומר...' : 'קח משימה'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
