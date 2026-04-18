import { useState } from 'react'
import { Button } from '../ui/button'
import type { CalendarSlot } from '../../types/database'

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

const SLOTS: { key: CalendarSlot | null; label: string }[] = [
  { key: 'morning',   label: 'בוקר-צהריים' },
  { key: 'noon',      label: 'צהריים-אחה"צ' },
  { key: 'afternoon', label: 'אחה"צ-ערב' },
  { key: null,        label: 'ללא שיוך' },
]

interface SlotPickerSheetProps {
  open: boolean
  choreTitle: string
  onConfirm: (selection: { calendarDay: number; calendarSlot: CalendarSlot | null }) => void
  onCancel: () => void
}

export default function SlotPickerSheet({ open, choreTitle, onConfirm, onCancel }: SlotPickerSheetProps) {
  const today = new Date().getDay()
  const [selectedDay, setSelectedDay] = useState(today)
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      dir="rtl"
    >
      <div className="w-full max-w-lg bg-background rounded-t-2xl p-5 space-y-4 shadow-xl">
        <h2 className="text-lg font-semibold">{choreTitle}</h2>

        {/* Day selector */}
        <div>
          <p className="text-sm text-muted-foreground mb-2">בחר יום</p>
          <div className="flex gap-1 flex-wrap">
            {DAY_NAMES.map((name, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setSelectedDay(index)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  selectedDay === index
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted hover:bg-muted/80'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Slot selector */}
        <div>
          <p className="text-sm text-muted-foreground mb-2">בחר חריץ זמן</p>
          <div className="space-y-2">
            {SLOTS.map(({ key, label }) => (
              <label key={String(key)} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="slot"
                  aria-label={label}
                  checked={selectedSlot === key}
                  onChange={() => setSelectedSlot(key)}
                  className="h-4 w-4"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            className="flex-1"
            onClick={() => onConfirm({ calendarDay: selectedDay, calendarSlot: selectedSlot })}
          >
            שייך אליי
          </Button>
          <Button variant="outline" onClick={onCancel}>
            ביטול
          </Button>
        </div>
      </div>
    </div>
  )
}
