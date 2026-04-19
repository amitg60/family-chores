import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useCalendarAssignments } from '../../../hooks/useCalendarAssignments'
import type { AssignmentWithDetails } from '../../../hooks/useCalendarAssignments'
import { useChores } from '../../../hooks/useChores'
import { supabase } from '../../../lib/supabase'
import WeeklyCalendarGrid from '../../../components/calendar/WeeklyCalendarGrid'
import type { CalendarSlot } from '../../../types/database'

const CHORE_DRAG_PREFIX = 'chore:'

export default function WeeklyCalendarPage() {
  const { profile } = useAuth()
  const { assignments, loading, error, refetch } = useCalendarAssignments()
  const { chores } = useChores()
  const [unscheduledDragOver, setUnscheduledDragOver] = useState(false)

  // All unscheduled assignments owned by this player
  const ownUnscheduled = assignments.filter(
    a => a.user_id === profile?.id && a.calendar_day === null
  )

  // Chore IDs the player already has an unscheduled assignment for
  const unscheduledChoreIds = new Set(ownUnscheduled.map(a => a.chore_id))

  // Virtual cards only for recurring chores the player hasn't taken yet this week
  const recurringVirtualCards = chores.filter(
    c => c.status === 'active' && c.is_pool_visible && c.recurrence_type !== 'none'
       && !unscheduledChoreIds.has(c.id)
  )

  async function handleDropOnCell(day: number, slot: CalendarSlot, id: string) {
    if (id.startsWith(CHORE_DRAG_PREFIX)) {
      // Virtual recurring card dropped on a slot — create new assignment
      const choreId = id.slice(CHORE_DRAG_PREFIX.length)
      await supabase.functions.invoke('self-assign-chore', {
        body: { chore_id: choreId, calendar_day: day, calendar_slot: slot },
      })
    } else {
      const assignment = assignments.find(a => a.id === id)
      if (assignment && assignment.chores.recurrence_type !== 'none' && assignment.calendar_day !== null) {
        // Already-scheduled recurring assignment dragged to another slot → create a copy, keep original
        await supabase.functions.invoke('self-assign-chore', {
          body: { chore_id: assignment.chore_id, calendar_day: day, calendar_slot: slot },
        })
      } else {
        // Non-recurring or unscheduled assignment → move to new slot
        await supabase
          .from('chore_assignments')
          .update({ calendar_day: day, calendar_slot: slot })
          .eq('id', id)
      }
    }
    refetch()
  }

  async function handleUnpin(a: AssignmentWithDetails) {
    await supabase
      .from('chore_assignments')
      .update({ calendar_day: null, calendar_slot: null })
      .eq('id', a.id)
    refetch()
  }

  async function handleToggleReminder(a: AssignmentWithDetails) {
    await supabase
      .from('chore_assignments')
      .update({ reminder_enabled: !a.reminder_enabled })
      .eq('id', a.id)
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
                {/* Actual unscheduled assignments (both recurring and non-recurring) */}
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
                  </div>
                ))}

                {/* Virtual cards for recurring chores not yet taken this week */}
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
