// src/pages/player/calendar/WeeklyCalendarPage.tsx
import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useCalendarAssignments } from '../../../hooks/useCalendarAssignments'
import type { AssignmentWithDetails } from '../../../hooks/useCalendarAssignments'
import { supabase } from '../../../lib/supabase'
import WeeklyCalendarGrid, { DAYS, SLOTS } from '../../../components/calendar/WeeklyCalendarGrid'
import { Button } from '../../../components/ui/button'
import { Label } from '../../../components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import type { CalendarSlot } from '../../../types/database'

export default function WeeklyCalendarPage() {
  const { profile } = useAuth()
  const { assignments, loading, error, refetch } = useCalendarAssignments()

  const [pinTarget, setPinTarget] = useState<AssignmentWithDetails | null>(null)
  const [pinDay, setPinDay] = useState('0')
  const [pinSlot, setPinSlot] = useState<CalendarSlot>('morning')
  const [pinSaving, setPinSaving] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  const ownUnscheduled = assignments.filter(
    a => a.user_id === profile?.id && a.calendar_day === null
  )

  function openPinDialog(a: AssignmentWithDetails) {
    setPinTarget(a)
    setPinDay(a.calendar_day !== null ? String(a.calendar_day) : '0')
    setPinSlot(a.calendar_slot ?? 'morning')
    setPinError(null)
  }

  async function submitPin() {
    if (!pinTarget) return
    setPinSaving(true)
    setPinError(null)
    const { error } = await supabase
      .from('chore_assignments')
      .update({ calendar_day: Number(pinDay), calendar_slot: pinSlot })
      .eq('id', pinTarget.id)
    setPinSaving(false)
    if (error) {
      setPinError('שגיאה בקביעת הזמן')
    } else {
      setPinTarget(null)
      refetch()
    }
  }

  async function handleUnpin(a: AssignmentWithDetails) {
    const { error } = await supabase
      .from('chore_assignments')
      .update({ calendar_day: null, calendar_slot: null })
      .eq('id', a.id)
    if (!error) refetch()
  }

  async function handleToggleReminder(a: AssignmentWithDetails) {
    await supabase
      .from('chore_assignments')
      .update({ reminder_enabled: !a.reminder_enabled })
      .eq('id', a.id)
    refetch()
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
            onChangePin={openPinDialog}
            onUnpin={handleUnpin}
            onToggleReminder={handleToggleReminder}
          />

          {ownUnscheduled.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-2">ללא סידור</h2>
              <div className="space-y-2">
                {ownUnscheduled.map(a => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between p-3 border rounded-lg bg-card"
                  >
                    <div>
                      <span className="font-medium">{a.chores.title}</span>
                      <span className="text-sm text-muted-foreground mr-2">
                        {a.chores.coin_value} מטבעות
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
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
                      <Button size="sm" onClick={() => openPinDialog(a)}>
                        קבע זמן
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <Dialog open={!!pinTarget} onOpenChange={open => { if (!open) setPinTarget(null) }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>קבע זמן למשימה</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>יום</Label>
              <Select value={pinDay} onValueChange={setPinDay}>
                <SelectTrigger aria-label="יום">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map(d => (
                    <SelectItem key={d.index} value={String(d.index)}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>שעה</Label>
              <Select value={pinSlot} onValueChange={v => setPinSlot(v as CalendarSlot)}>
                <SelectTrigger aria-label="שעה">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLOTS.map(s => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {pinError && (
              <p role="alert" className="text-sm text-destructive">{pinError}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPinTarget(null)}>ביטול</Button>
            <Button onClick={submitPin} disabled={pinSaving}>
              {pinSaving ? 'שומר...' : 'שמור'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
