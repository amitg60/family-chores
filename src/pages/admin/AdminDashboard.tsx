import { Link } from 'react-router-dom'
import { useChores } from '../../hooks/useChores'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'

export default function AdminDashboard() {
  const { chores } = useChores()
  const pendingCount = chores.filter(c => c.status === 'pending_approval').length

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">דשבורד מנהל</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              הצעות ממתינות לאישור
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingCount}</p>
            <Button variant="link" className="px-0 mt-1 h-auto text-sm" asChild>
              <Link to="/admin/chores">לניהול משימות ←</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
