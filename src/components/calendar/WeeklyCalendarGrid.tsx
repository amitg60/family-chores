import { useMemo, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import type { AssignmentWithDetails } from '../../hooks/useCalendarAssignments'
import type { CalendarSlot, AssignmentStatus } from '../../types/database'

export const DAYS = [
  { index: 0, label: 'ראשון' },
  { index: 1, label: 'שני' },
  { index: 2, label: 'שלישי' },
  { index: 3, label: 'רביעי' },
  { index: 4, label: 'חמישי' },
  { index: 5, label: 'שישי' },
  { index: 6, label: 'שבת' },
]

export const SLOTS: { key: CalendarSlot; label: string }[] = [
  { key: 'morning', label: '🌅 בוקר-צהריים' },
  { key: 'noon', label: '☀️ צהריים-אחה"צ' },
  { key: 'afternoon', label: '🌆 אחה"צ-ערב' },
]

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  pending: 'ממתין',
  in_progress: 'בביצוע',
  completed: 'הושלם',
  overdue: 'באיחור',
  failed: 'נכשל',
}

const MEMBER_COLORS = [
  'bg-blue-100 border-blue-300',
  'bg-green-100 border-green-300',
  'bg-yellow-100 border-yellow-300',
  'bg-pink-100 border-pink-300',
  'bg-purple-100 border-purple-300',
]

interface AssignmentCardProps {
  assignment: AssignmentWithDetails
  color: string
  isOwn: boolean
  onChangePin?: (assignment: AssignmentWithDetails) => void
  onUnpin?: (assignment: AssignmentWithDetails) => void
  onToggleReminder?: (assignment: AssignmentWithDetails) => void
}

function AssignmentCard({
  assignment: a,
  color,
  isOwn,
  onChangePin,
  onUnpin,
  onToggleReminder,
}: AssignmentCardProps) {
  return (
    <div className={`rounded border p-1.5 text-xs space-y-1 ${color}`}>
      <div className="flex items-center gap-1">
        <Avatar className="h-5 w-5">
          <AvatarImage src={a.profiles.avatar_url ?? undefined} />
          <AvatarFallback className="text-[10px]">{a.profiles?.name?.[0] ?? '?'}</AvatarFallback>
        </Avatar>
        <span className="font-medium truncate">{a.chores.title}</span>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <Badge variant="secondary" className="text-[10px] px-1 h-4">
          {STATUS_LABEL[a.status]}
        </Badge>
        {isOwn && onChangePin && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1 text-[10px]"
            onClick={() => onChangePin(a)}
          >
            שנה זמן
          </Button>
        )}
        {isOwn && onUnpin && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1 text-[10px]"
            onClick={() => onUnpin(a)}
          >
            הסר
          </Button>
        )}
      </div>
      {isOwn && onToggleReminder && (
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            aria-label="תזכורת"
            checked={a.reminder_enabled}
            onChange={() => onToggleReminder(a)}
            className="h-3 w-3"
          />
          <span>תזכורת</span>
        </label>
      )}
    </div>
  )
}

interface WeeklyCalendarGridProps {
  assignments: AssignmentWithDetails[]
  currentUserId?: string
  onChangePin?: (assignment: AssignmentWithDetails) => void
  onUnpin?: (assignment: AssignmentWithDetails) => void
  onToggleReminder?: (assignment: AssignmentWithDetails) => void
}

export default function WeeklyCalendarGrid({
  assignments,
  currentUserId,
  onChangePin,
  onUnpin,
  onToggleReminder,
}: WeeklyCalendarGridProps) {
  const todayIndex = new Date().getDay()
  const [selectedDay, setSelectedDay] = useState(todayIndex)

  // Stable colour per user — first seen = first colour
  const colorMap = useMemo(() => {
    const ids = [...new Set(assignments.map(a => a.user_id))]
    const map: Record<string, string> = {}
    ids.forEach((id, i) => {
      map[id] = MEMBER_COLORS[i % MEMBER_COLORS.length]
    })
    return map
  }, [assignments])

  // Only pinned assignments belong in the grid
  const pinned = assignments.filter(
    a => a.calendar_day !== null && a.calendar_slot !== null
  )

  function cellAssignments(day: number, slot: CalendarSlot) {
    return pinned.filter(
      a => a.calendar_day === day && a.calendar_slot === slot
    )
  }

  function renderCard(a: AssignmentWithDetails) {
    return (
      <AssignmentCard
        key={a.id}
        assignment={a}
        color={colorMap[a.user_id] ?? 'bg-gray-100 border-gray-300'}
        isOwn={a.user_id === currentUserId}
        onChangePin={onChangePin}
        onUnpin={onUnpin}
        onToggleReminder={onToggleReminder}
      />
    )
  }

  return (
    <>
      {/* ── Mobile: day-picker + single-day view ── */}
      <div className="md:hidden" dir="rtl">
        {/* Day selector */}
        <div className="flex gap-1 overflow-x-auto pb-1 mb-3">
          {DAYS.map(day => (
            <button
              key={day.index}
              onClick={() => setSelectedDay(day.index)}
              className={`shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                selectedDay === day.index
                  ? 'bg-primary text-primary-foreground'
                  : day.index === todayIndex
                  ? 'bg-muted font-semibold'
                  : 'hover:bg-muted text-muted-foreground'
              }`}
            >
              {day.label}
            </button>
          ))}
        </div>

        {/* Slots for the selected day */}
        <div className="space-y-3">
          {SLOTS.map(slot => {
            const cards = cellAssignments(selectedDay, slot.key)
            return (
              <div key={slot.key}>
                <p className="text-xs text-muted-foreground font-medium mb-1">{slot.label}</p>
                <div
                  className="min-h-[56px] bg-muted/30 rounded p-2 space-y-1"
                  data-testid={`cell-${selectedDay}-${slot.key}`}
                >
                  {cards.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60 pt-1">ריק</p>
                  ) : (
                    cards.map(renderCard)
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Desktop/landscape: full 7-column grid ── */}
      <div className="hidden md:block overflow-x-auto" dir="rtl">
        <div className="min-w-[600px]">
          {/* Header row: empty corner + 7 day labels */}
          <div className="grid grid-cols-8 gap-1 mb-1">
            <div />
            {DAYS.map(day => (
              <div
                key={day.index}
                className={`text-center text-xs font-semibold py-1 ${
                  day.index === todayIndex ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {day.label}
              </div>
            ))}
          </div>
          {/* Slot rows */}
          {SLOTS.map(slot => (
            <div key={slot.key} className="grid grid-cols-8 gap-1 mb-1">
              <div className="text-xs text-muted-foreground pt-1 leading-tight">
                {slot.label}
              </div>
              {DAYS.map(day => (
                <div
                  key={day.index}
                  className="min-h-[60px] bg-muted/30 rounded p-1 space-y-1"
                  data-testid={`cell-${day.index}-${slot.key}`}
                >
                  {cellAssignments(day.index, slot.key).map(renderCard)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
