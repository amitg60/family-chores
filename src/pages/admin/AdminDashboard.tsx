import { Link } from 'react-router-dom'
import { useChores } from '../../hooks/useChores'
import { usePendingRedemptions } from '../../hooks/usePendingRedemptions'
import { usePendingCompletions } from '../../hooks/usePendingCompletions'
import { useAdminDashboardStats } from '../../hooks/useAdminDashboardStats'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'

export default function AdminDashboard() {
  const { chores } = useChores()
  const { redemptions } = usePendingRedemptions()
  const { completions } = usePendingCompletions()
  const { leaderboard, totalCoinsThisWeek, activeTradesCount, loading: statsLoading } = useAdminDashboardStats()

  const pendingProposalsCount = chores.filter(c => c.status === 'pending_approval').length
  const pendingRedemptionsCount = redemptions.length
  const pendingCompletionsCount = completions.length

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">דשבורד מנהל</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">הצעות ממתינות לאישור</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingProposalsCount}</p>
            <Button variant="link" className="px-0 mt-1 h-auto text-sm" asChild>
              <Link to="/admin/chores">לניהול משימות ←</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">בקשות מימוש ממתינות</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingRedemptionsCount}</p>
            <Button variant="link" className="px-0 mt-1 h-auto text-sm" asChild>
              <Link to="/admin/redemptions">לבקשות מימוש ←</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">הגשות ממתינות לאישור</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingCompletionsCount}</p>
            <Button variant="link" className="px-0 mt-1 h-auto text-sm" asChild>
              <Link to="/admin/completions">לאישור הגשות ←</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">עסקאות פעילות</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{statsLoading ? '—' : activeTradesCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">מטבעות הושגו השבוע (כל המשפחה)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-green-600">{statsLoading ? '—' : `🪙 ${totalCoinsThisWeek}`}</p>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-3">טבלת המובילים השבועית</h2>
        {statsLoading ? (
          <p className="text-muted-foreground text-sm">טוען...</p>
        ) : leaderboard.length === 0 ? (
          <p className="text-muted-foreground text-sm">אין נתונים לשבוע זה.</p>
        ) : (
          <div className="space-y-2">
            {leaderboard.map((entry, idx) => (
              <div key={entry.userId} className="flex items-center gap-3 py-2 border-b last:border-0">
                <span className="text-muted-foreground text-sm w-5 text-center">{idx + 1}</span>
                <Avatar className="h-8 w-8">
                  <AvatarImage src={entry.avatarUrl ?? undefined} />
                  <AvatarFallback>{entry.name[0]}</AvatarFallback>
                </Avatar>
                <span className="flex-1 text-sm font-medium">{entry.name}</span>
                <span className="text-sm font-semibold text-green-600">🪙 {entry.weeklyEarned}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
