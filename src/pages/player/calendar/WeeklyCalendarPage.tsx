// src/pages/player/calendar/WeeklyCalendarPage.tsx
import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useCalendarAssignments } from '../../../hooks/useCalendarAssignments'
import type { AssignmentWithDetails } from '../../../hooks/useCalendarAssignments'
import { supabase } from '../../../lib/supabase'
import WeeklyCalendarGrid from '../../../components/calendar/WeeklyCalendarGrid'
import type { CalendarSlot } from '../../../types/database'

export default function WeeklyCalendarPage() {
  const { profile } = useAuth()
  const { assignments, loading, error, refetch } = useCalendarAssignments()
  const [unscheduledDragOver, setUnscheduledDragOver] = useState(false)

  const ownUnscheduled = assignments.filter(
    a => a.user_id === profile?.id && a.calendar_day === null
  )

  async function handleDropOnCell(day: number, slot: CalendarSlot, assignmentId: string) {
    await supabase
      .from('chore_assignments')
      .update({ calendar_day: day, calendar_slot: slot })
      .eq('id', assignmentId)
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
    if (id) {
      const a = assignments.find(x => x.id === id)
      if (a) handleUnpin(a)
    }
  }

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
            {ownUnscheduled.length === 0 ? (
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
