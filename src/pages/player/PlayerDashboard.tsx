import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useChoreAssignments } from '../../hooks/useChoreAssignments'
import { useChores } from '../../hooks/useChores'
import { useAchievements } from '../../hooks/useAchievements'
import { useActivityFeed } from '../../hooks/useActivityFeed'
import { useWeeklyPopulation } from '../../hooks/useWeeklyPopulation'
import { checkAndAwardAchievements } from '../../lib/checkAchievements'
import { useToast } from '../../hooks/use-toast'
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

function getStatusLabel(a: { status: AssignmentStatus; hasRejection?: boolean }): string {
  if (a.status === 'pending' && a.hasRejection) return 'ממתין לשליחה מחדש'
  return statusLabel[a.status]
}

export default function PlayerDashboard() {
  const { profile } = useAuth()
  const { assignments, loading } = useChoreAssignments(profile?.id)
  const { chores } = useChores()
  const {
    achievements,
    earnedIds,
    totalCompletedAllTime,
    loading: achievementsLoading,
    refetch: achievementsRefetch,
  } = useAchievements(profile?.id)
  const { items: feedItems } = useActivityFeed(profile?.family_id ?? null)
  const { toast } = useToast()
  useWeeklyPopulation()

  useEffect(() => {
    if (!profile?.family_id || loading || achievementsLoading) return

    const completedThisWeek = assignments.filter(a => a.status === 'completed').length

    checkAndAwardAchievements({
      userId: profile.id,
      coinBalance: profile.coin_balance,
      completedThisWeek,
      totalCompletedAllTime,
      earnedIds,
      achievements,
    }).then(newlyEarned => {
      if (newlyEarned.length > 0) {
        for (const key of newlyEarned) {
          const a = achievements.find(ach => ach.key === key)
          if (a) {
            toast({ title: '🏆 הישג חדש!', description: `${a.icon} ${a.title_he}` })
          }
        }
        achievementsRefetch()
      }
    })
    .catch(err => console.error('[PlayerDashboard] achievement check failed', err))
  }, [profile, loading, assignments, achievementsLoading, achievements, earnedIds, totalCompletedAllTime])

  function choreTitle(choreId: string): string {
    return chores.find(c => c.id === choreId)?.title ?? 'משימה'
  }

  function choreCoins(choreId: string): number {
    return chores.find(c => c.id === choreId)?.coin_value ?? 0
  }

  // Group assignments by chore so recurring tasks with multiple slots show a count
  const grouped = assignments.reduce<Record<string, typeof assignments>>((acc, a) => {
    ;(acc[a.chore_id] ??= []).push(a)
    return acc
  }, {})

  const displayGroups = Object.values(grouped).map(group => {
    const actionable = group.find(a => a.status === 'pending' || a.status === 'in_progress') ?? group[0]
    return { representative: actionable, count: group.length }
  })

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">המשימות שלי</h1>
        <Button asChild>
          <Link to="/player/pool">בחר משימה</Link>
        </Button>
      </div>

      {feedItems.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {feedItems.map(item => (
            <div
              key={item.id}
              className="flex items-center gap-1 shrink-0 rounded-full bg-muted px-3 py-1 text-sm"
            >
              <span>{item.achievementIcon}</span>
              <span>{item.profileName}</span>
              <span className="text-muted-foreground">{item.achievementTitle}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : assignments.length === 0 ? (
        <p className="text-muted-foreground">אין משימות השבוע. לחץ על "בחר משימה" להוסיף.</p>
      ) : (
        <div className="space-y-3">
          {displayGroups.map(({ representative: a, count }) => (
            <Card key={a.chore_id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{choreTitle(a.chore_id)}</p>
                    {count > 1 && (
                      <Badge variant="secondary" className="text-xs">
                        {count} משימות
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{choreCoins(a.chore_id)} מטבעות</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant[a.status]}>
                    {getStatusLabel(a)}
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
