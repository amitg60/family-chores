import { useCalendarAssignments } from '../../../hooks/useCalendarAssignments'
import WeeklyCalendarGrid from '../../../components/calendar/WeeklyCalendarGrid'

export default function AdminCalendarPage() {
  const { assignments, loading, error } = useCalendarAssignments()

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">לוח שבועי</h1>

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : (
        <WeeklyCalendarGrid assignments={assignments} />
      )}
    </div>
  )
}
