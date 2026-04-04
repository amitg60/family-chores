import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useChoreAssignments } from '../../hooks/useChoreAssignments'
import { useChores } from '../../hooks/useChores'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'
import type { AssignmentStatus } from '../../types/database'

const statusLabel: Record<AssignmentStatus, string> = {
  pending: 'ממתין',
  in_progress: 'בביצוע',
  completed: 'הושלם',
  overdue: 'באיחור',
  failed: 'נכשל',
}

const statusVariant: Record<AssignmentStatus, 'default' | 'secondary' | 'destructive'> = {
  pending: 'secondary',
  in_progress: 'default',
  completed: 'secondary',
  overdue: 'destructive',
  failed: 'destructive',
}

export default function PlayerDashboard() {
  const { profile } = useAuth()
  const { assignments, loading } = useChoreAssignments(profile?.id)
  const { chores } = useChores()

  function choreTitle(choreId: string): string {
    return chores.find(c => c.id === choreId)?.title ?? 'משימה'
  }

  function choreCoins(choreId: string): number {
    return chores.find(c => c.id === choreId)?.coin_value ?? 0
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">המשימות שלי</h1>
        <Button asChild>
          <Link to="/player/pool">בחר משימה</Link>
        </Button>
      </div>

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : assignments.length === 0 ? (
        <p className="text-muted-foreground">אין משימות השבוע. לחץ על "בחר משימה" להוסיף.</p>
      ) : (
        <div className="space-y-3">
          {assignments.map(a => (
            <Card key={a.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{choreTitle(a.chore_id)}</p>
                  <p className="text-sm text-muted-foreground">{choreCoins(a.chore_id)} מטבעות</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant[a.status]}>
                    {statusLabel[a.status]}
                  </Badge>
                  {(a.status === 'pending' || a.status === 'in_progress') && (
                    <Button size="sm" asChild>
                      <Link to={`/player/chores/${a.id}/complete`}>סיימתי</Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
