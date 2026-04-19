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
  onUnpin?: (assignment: AssignmentWithDetails) => void
  onToggleReminder?: (assignment: AssignmentWithDetails) => void
}

function AssignmentCard({
  assignment: a,
  color,
  isOwn,
  onUnpin,
  onToggleReminder,
}: AssignmentCardProps) {
  return (
    <div
      className={`rounded border p-1.5 text-xs space-y-1 ${color} ${isOwn ? 'cursor-grab active:cursor-grabbing' : ''}`}
      draggable={isOwn}
      onDragStart={isOwn ? (e) => e.dataTransfer.setData('text/plain', a.id) : undefined}
    >
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

interface SlotCellProps {
  cards: AssignmentWithDetails[]
  renderCard: (a: AssignmentWithDetails) => React.ReactNode
  className: string
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  testId: string
}

function SlotCell({ cards, renderCard, className, onDragOver, onDragLeave, onDrop, testId }: SlotCellProps) {
  const [expanded, setExpanded] = useState(false)
  const COLLAPSE_AT = 3
  const showCollapse = cards.length >= COLLAPSE_AT && !expanded
  const visibleCards = showCollapse ? cards.slice(0, 2) : cards

  return (
    <div
      className={className}
      data-testid={testId}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {visibleCards.map(a => renderCard(a))}
      {showCollapse && (
        <button
          type="button"
          className="text-xs text-primary underline mt-0.5 text-right w-full"
          onClick={() => setExpanded(true)}
        >
          ועוד {cards.length - 2} משימות ▾
        </button>
      )}
      {cards.length === 0 && (
        <p className="text-xs text-muted-foreground/60 pt-1">גרור לכאן</p>
      )}
    </div>
  )
}

interface WeeklyCalendarGridProps {
  assignments: AssignmentWithDetails[]
  currentUserId?: string
  onUnpin?: (assignment: AssignmentWithDetails) => void
  onToggleReminder?: (assignment: AssignmentWithDetails) => void
  onDropOnCell?: (day: number, slot: CalendarSlot, assignmentId: string) => void
}

export default function WeeklyCalendarGrid({
  assignments,
  currentUserId,
  onUnpin,
  onToggleReminder,
  onDropOnCell,
}: WeeklyCalendarGridProps) {
  const todayIndex = new Date().getDay()
  const [selectedDay, setSelectedDay] = useState(todayIndex)
  const [dragOverCell, setDragOverCell] = useState<string | null>(null)

  const colorMap = useMemo(() => {
    const ids = [...new Set(assignments.map(a => a.user_id))]
    const map: Record<string, string> = {}
    ids.forEach((id, i) => {
      map[id] = MEMBER_COLORS[i % MEMBER_COLORS.length]
    })
    return map
  }, [assignments])

  const pinned = assignments.filter(
    a => a.calendar_day !== null && a.calendar_slot !== null
  )

  function cellAssignments(day: number, slot: CalendarSlot) {
    return pinned.filter(a => a.calendar_day === day && a.calendar_slot === slot)
  }

  function cellKey(day: number, slot: CalendarSlot) {
    return `${day}-${slot}`
  }

  function handleDragOver(e: React.DragEvent, day: number, slot: CalendarSlot) {
    e.preventDefault()
    setDragOverCell(cellKey(day, slot))
  }

  function handleDrop(e: React.DragEvent, day: number, slot: CalendarSlot) {
    e.preventDefault()
    setDragOverCell(null)
    const id = e.dataTransfer.getData('text/plain')
    if (id) onDropOnCell?.(day, slot, id)
  }

  function renderCard(a: AssignmentWithDetails) {
    return (
      <AssignmentCard
        key={a.id}
        assignment={a}
        color={colorMap[a.user_id] ?? 'bg-gray-100 border-gray-300'}
        isOwn={a.user_id === currentUserId}
        onUnpin={onUnpin}
        onToggleReminder={onToggleReminder}
      />
    )
  }

  function cellClass(day: number, slot: CalendarSlot, base: string) {
    return dragOverCell === cellKey(day, slot)
      ? `${base} bg-primary/20 ring-2 ring-primary/40`
      : `${base} bg-muted/30`
  }

  return (
    <>
      {/* ── Mobile portrait: day-picker + single-day view ── */}
      <div className="landscape:hidden md:hidden" dir="rtl">
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

        <div className="space-y-3">
          {SLOTS.map(slot => {
            const cards = cellAssignments(selectedDay, slot.key)
            return (
              <div key={slot.key}>
                <p className="text-xs text-muted-foreground font-medium mb-1">{slot.label}</p>
                <SlotCell
                  cards={cards}
                  renderCard={renderCard}
                  className={`min-h-[56px] rounded p-2 space-y-1 transition-colors ${cellClass(selectedDay, slot.key, '')}`}
                  testId={`cell-${selectedDay}-${slot.key}`}
                  onDragOver={(e) => handleDragOver(e, selectedDay, slot.key)}
                  onDragLeave={() => setDragOverCell(null)}
                  onDrop={(e) => handleDrop(e, selectedDay, slot.key)}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Landscape / desktop: full 7-column grid ── */}
      <div className="hidden landscape:block md:block overflow-x-auto" dir="rtl">
        <div className="min-w-[600px]">
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
          {SLOTS.map(slot => (
            <div key={slot.key} className="grid grid-cols-8 gap-1 mb-1">
              <div className="text-xs text-muted-foreground pt-1 leading-tight">
                {slot.label}
              </div>
              {DAYS.map(day => (
                <div
                  key={day.index}
                  className={`min-h-[60px] rounded p-1 space-y-1 transition-colors ${cellClass(day.index, slot.key, '')}`}
                  data-testid={`cell-${day.index}-${slot.key}`}
                  onDragOver={(e) => handleDragOver(e, day.index, slot.key)}
                  onDragLeave={() => setDragOverCell(null)}
                  onDrop={(e) => handleDrop(e, day.index, slot.key)}
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
