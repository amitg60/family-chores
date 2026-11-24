import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useChoreAssignments } from '../../hooks/useChoreAssignments'
import { useChores } from '../../hooks/useChores'
import { useAchievements } from '../../hooks/useAchievements'
import { useActivityFeed } from '../../hooks/useActivityFeed'
import { useWeeklyPopulation } from '../../hooks/useWeeklyPopulation'
import { usePenalties } from '../../hooks/usePenalties'
import { checkAndAwardAchievements } from '../../lib/checkAchievements'
import { useToast } from '../../hooks/use-toast'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'
import type { AssignmentStatus } from '../../types/database'
import './PlayerDashboard-EnhancedUI.css'

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

// Chores have no icon field: use a leading emoji in the title if there is one.
function choreEmoji(title: string): string {
  return title.match(/^\p{Extended_Pictographic}️?/u)?.[0] ?? '📋'
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
  const { penalties } = usePenalties()

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
    <div className="enhanced-dashboard" dir="rtl">
      <div className="dashboard-header">
        <div className="header-greeting">היי, {profile?.name}! 👋</div>
        <div className="header-stats">
          <div className="stat-badge" aria-label="מטבעות">
            <span aria-hidden="true">🪙</span>
            <span className="stat-number">{profile?.coin_balance ?? 0}</span>
          </div>
          <div className="stat-badge" aria-label="הישגים">
            <span aria-hidden="true">🏅</span>
            <span className="stat-number">{earnedIds.size}</span>
          </div>
        </div>
      </div>

      {feedItems.length > 0 && (
        <div className="feed-row">
          {feedItems.map(item => (
            <div key={item.id} className="feed-chip">
              <span>{item.achievementIcon}</span>
              <span>{item.profileName}</span>
              <span className="feed-chip-muted">{item.achievementTitle}</span>
            </div>
          ))}
        </div>
      )}

      <div className="dashboard-content">
        <div className="content-header">
          <div>
            <h1 className="content-title">המשימות שלי</h1>
            <p className="content-subtitle">השלם משימות וזכה בעוד מטבעות!</p>
          </div>
          <Button asChild className="choose-chore-btn">
            <Link to="/player/pool">בחר משימה</Link>
          </Button>
        </div>

        {loading ? (
          <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
        ) : assignments.length === 0 ? (
          <div className="empty-state">
            <div className="empty-emoji" aria-hidden="true">📋</div>
            <div className="empty-text">אין משימות השבוע. בחר משימה כדי להתחיל!</div>
          </div>
        ) : (
          <div className="tasks-container">
            {displayGroups.map(({ representative: a, count }) => {
              const chore = chores.find(c => c.id === a.chore_id)
              const title = chore?.title ?? 'משימה'
              const canComplete = a.status === 'pending' || a.status === 'in_progress'
              return (
                <div key={a.chore_id} className={`task-card task-${a.status}`}>
                  <div className="task-emoji" aria-hidden="true">{choreEmoji(title)}</div>
                  <div className="task-info">
                    <div className="task-name">{title}</div>
                    <div className="task-meta">
                      <span className="task-coins">🪙 {chore?.coin_value ?? 0} מטבעות</span>
                      <Badge variant={statusVariant[a.status]}>{getStatusLabel(a)}</Badge>
                      {count > 1 && <Badge variant="secondary">{count} משימות</Badge>}
                    </div>
                  </div>
                  {canComplete ? (
                    <Link
                      to={`/player/chores/${a.id}/complete`}
                      className="checkbox-circle"
                      aria-label="סיימתי"
                      title="סיימתי"
                    />
                  ) : a.status === 'completed' ? (
                    <span className="checkbox-circle checked" aria-hidden="true">✓</span>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {penalties.length > 0 && (
        <div className="dashboard-content space-y-2">
          <h2 className="section-title">היסטוריית הפסדים</h2>
          {penalties.map(p => (
            <Card key={p.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{p.chore_assignments.chores.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(p.applied_at).toLocaleDateString('he-IL')} — {p.coin_deduction} מטבעות
                  </p>
                </div>
                {p.waived_by ? (
                  <Badge variant="secondary">בוטל</Badge>
                ) : (
                  <Badge variant="destructive">{p.coin_deduction} הופחת</Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
