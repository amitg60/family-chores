import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useCalendarAssignments } from '../../../hooks/useCalendarAssignments'
import type { AssignmentWithDetails } from '../../../hooks/useCalendarAssignments'
import { useChores } from '../../../hooks/useChores'
import { useToast } from '../../../hooks/use-toast'
import { supabase } from '../../../lib/supabase'
import WeeklyCalendarGrid from '../../../components/calendar/WeeklyCalendarGrid'
import type { CalendarSlot } from '../../../types/database'

const CHORE_DRAG_PREFIX = 'chore:'

export default function WeeklyCalendarPage() {
  const { profile } = useAuth()
  const { assignments, loading, error, refetch } = useCalendarAssignments()
  const { chores } = useChores()
  const { toast } = useToast()
  const [unscheduledDragOver, setUnscheduledDragOver] = useState(false)

  const ownUnscheduled = assignments.filter(
    a => a.user_id === profile?.id && a.calendar_day === null
  )

  const unscheduledChoreIds = new Set(ownUnscheduled.map(a => a.chore_id))

  const recurringVirtualCards = chores.filter(
    c => c.status === 'active' && c.is_pool_visible && c.recurrence_type !== 'none'
       && !unscheduledChoreIds.has(c.id)
  )

  async function handleDropOnCell(day: number, slot: CalendarSlot, id: string) {
    if (id.startsWith(CHORE_DRAG_PREFIX)) {
      const choreId = id.slice(CHORE_DRAG_PREFIX.length)
      await supabase.functions.invoke('self-assign-chore', {
        body: { chore_id: choreId, calendar_day: day, calendar_slot: slot },
      })
    } else {
      const assignment = assignments.find(a => a.id === id)
      if (assignment && assignment.chores.recurrence_type !== 'none' && assignment.calendar_day !== null) {
        await supabase.functions.invoke('self-assign-chore', {
          body: { chore_id: assignment.chore_id, calendar_day: day, calendar_slot: slot },
        })
      } else {
        const { error } = await supabase.rpc('reschedule_assignment', {
          p_assignment_id: id,
          p_day: day,
          p_slot: slot,
        })
        if (error) {
          toast({ variant: 'destructive', title: 'שגיאה', description: error.message })
          return
        }
      }
    }
    refetch()
  }

  async function handleUnpin(a: AssignmentWithDetails) {
    if (a.chores.recurrence_type !== 'none') {
      await supabase.from('chore_assignments').delete().eq('id', a.id)
    } else {
      const { error } = await supabase.rpc('reschedule_assignment', {
        p_assignment_id: a.id,
        p_day: null,
        p_slot: null,
      })
      if (error) {
        toast({ variant: 'destructive', title: 'שגיאה', description: error.message })
        return
      }
    }
    refetch()
  }

  async function handleToggleReminder(a: AssignmentWithDetails) {
    const { error } = await supabase.rpc('toggle_reminder', { p_assignment_id: a.id })
    if (error) {
      toast({ variant: 'destructive', title: 'שגיאה', description: error.message })
      return
    }
    refetch()
  }

  function handleDropUnscheduled(e: React.DragEvent) {
    e.preventDefault()
    setUnscheduledDragOver(false)
    const id = e.dataTransfer.getData('text/plain')
    if (id && !id.startsWith(CHORE_DRAG_PREFIX)) {
      const a = assignments.find(x => x.id === id)
      if (a) handleUnpin(a)
    }
  }

  const hasUnscheduled = recurringVirtualCards.length > 0 || ownUnscheduled.length > 0

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">לוח שבועי</h1>

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : (
        <>
          <WeeklyCalendarGrid
            assignments={assignments}
            currentUserId={profile?.id}
            onUnpin={handleUnpin}
            onToggleReminder={handleToggleReminder}
            onDropOnCell={handleDropOnCell}
          />

          <section
            onDragOver={(e) => { e.preventDefault(); setUnscheduledDragOver(true) }}
            onDragLeave={() => setUnscheduledDragOver(false)}
            onDrop={handleDropUnscheduled}
          >
            <h2 className="text-lg font-semibold mb-2">ללא סידור</h2>
            {!hasUnscheduled ? (
              <div
                className={`min-h-[56px] rounded-lg border-2 border-dashed flex items-center justify-center text-sm text-muted-foreground transition-colors ${
                  unscheduledDragOver ? 'border-primary bg-primary/10' : 'border-muted-foreground/30'
                }`}
              >
                גרור משימה לכאן להסרה מהלוח
              </div>
            ) : (
              <div className={`space-y-2 p-2 rounded-lg transition-colors ${unscheduledDragOver ? 'bg-primary/10 ring-2 ring-primary/40' : ''}`}>
                {ownUnscheduled.map(a => (
                  <div
                    key={a.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', a.id)}
                    className="flex items-center justify-between p-3 border rounded-lg bg-card cursor-grab active:cursor-grabbing"
                  >
                    <div>
                      <span className="font-medium">{a.chores.title}</span>
                      <span className="text-sm text-muted-foreground mr-2">
                        {a.chores.coin_value} מטבעות
                      </span>
                      {a.chores.recurrence_type !== 'none' && (
                        <span className="text-xs text-muted-foreground">🔁</span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          aria-label="תזכורת"
                          checked={a.reminder_enabled}
                          onChange={() => handleToggleReminder(a)}
                          className="h-4 w-4"
                        />
                        תזכורת
                      </label>
                      {a.reminder_enabled && a.reminder_sent_at && (
                        <p className="text-xs text-muted-foreground">
                          תזכורת נשלחה — העבר למשבצת אחרת או כבה והדלק מחדש
                        </p>
                      )}
                    </div>
                  </div>
                ))}

                {recurringVirtualCards.map(chore => (
                  <div
                    key={chore.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `${CHORE_DRAG_PREFIX}${chore.id}`)}
                    className="flex items-center justify-between p-3 border border-dashed rounded-lg bg-muted/30 cursor-grab active:cursor-grabbing"
                  >
                    <div>
                      <span className="font-medium">{chore.title}</span>
                      <span className="text-xs text-muted-foreground mr-2">🔁 {chore.coin_value} מטבעות</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
