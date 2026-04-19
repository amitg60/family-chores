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

  // Recurring pool chores always remain available — shown as persistent virtual cards
  const recurringPoolChores = chores.filter(
    c => c.status === 'active' && c.is_pool_visible && c.recurrence_type !== 'none'
  )

  // Only non-recurring unscheduled assignments need a card (recurring are shown as virtual cards above)
  const ownUnscheduled = assignments.filter(
    a => a.user_id === profile?.id && a.calendar_day === null && a.chores.recurrence_type === 'none'
  )

  async function handleDropOnCell(day: number, slot: CalendarSlot, id: string) {
    if (id.startsWith(CHORE_DRAG_PREFIX)) {
      // Recurring chore virtual card dropped onto a slot — self-assign with that slot
      const choreId = id.slice(CHORE_DRAG_PREFIX.length)
      await supabase.functions.invoke('self-assign-chore', {
        body: { chore_id: choreId, calendar_day: day, calendar_slot: slot },
      })
    } else {
      // Existing assignment moved to a new slot
      await supabase
        .from('chore_assignments')
        .update({ calendar_day: day, calendar_slot: slot })
        .eq('id', id)
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
      // Only unpin non-recurring assignments — recurring ones stay in their slot
      if (a && a.chores.recurrence_type === 'none') handleUnpin(a)
    }
  }

  const hasUnscheduled = recurringPoolChores.length > 0 || ownUnscheduled.length > 0

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
                {/* Recurring pool chores — always available, drag to any slot */}
                {recurringPoolChores.map(chore => (
                  <div
                    key={chore.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', `${CHORE_DRAG_PREFIX}${chore.id}`)}
                    className="flex items-center justify-between p-3 border rounded-lg bg-card cursor-grab active:cursor-grabbing border-dashed"
                  >
                    <div>
                      <span className="font-medium">{chore.title}</span>
                      <span className="text-xs text-muted-foreground mr-2">🔁 {chore.coin_value} מטבעות</span>
                    </div>
                  </div>
                ))}

                {/* Non-recurring unscheduled assignments */}
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
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
