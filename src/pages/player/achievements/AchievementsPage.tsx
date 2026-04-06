import { useAuth } from '../../../contexts/AuthContext'
import { useAchievements } from '../../../hooks/useAchievements'
import { Card, CardContent } from '../../../components/ui/card'

export default function AchievementsPage() {
  const { profile } = useAuth()
  const { achievements, earnedIds, loading, error } = useAchievements(profile?.id)

  const earnedCount = earnedIds.size
  const totalCount = achievements.length

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">הישגים</h1>
        {totalCount > 0 && (
          <span className="text-sm text-muted-foreground">{earnedCount} מתוך {totalCount}</span>
        )}
      </div>

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {achievements.map(a => {
            const isEarned = a.earned_at !== null
            return (
              <Card key={a.id} className={isEarned ? '' : 'opacity-50'}>
                <CardContent className="py-3 flex items-start gap-3">
                  <span className="text-3xl">{a.icon}</span>
                  <div className="space-y-1 flex-1">
                    <p className="font-semibold text-sm">{a.title_he}</p>
                    <p className="text-xs text-muted-foreground">{a.description_he}</p>
                    {isEarned ? (
                      <p className="text-xs text-green-600">
                        הושג ב‑{new Date(a.earned_at!).toLocaleDateString('he-IL')}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">🔒 לא הושג עדיין</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
