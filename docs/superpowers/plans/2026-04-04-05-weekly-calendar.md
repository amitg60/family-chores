# Weekly Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared weekly family calendar where all members can see pinned chore assignments and players can pin their own assignments to a day + time slot and toggle reminders.

**Architecture:** A new `useCalendarAssignments` hook fetches all family assignments for the current week with chore and profile joins. A shared `WeeklyCalendarGrid` component renders a 7-day × 3-slot grid with colour-coded assignment cards. The player page adds a pin dialog and reminder toggles; the admin page is read-only. No new migrations are needed — `calendar_day`, `calendar_slot`, and `reminder_enabled` already exist in `chore_assignments` and existing RLS already allows family-wide reads and own-row updates.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, shadcn/ui (Dialog, Select, Button, Badge, Avatar), Supabase JS v2, Vitest + React Testing Library

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `src/hooks/useCalendarAssignments.ts` | Create | Fetch all family assignments for current week with chore+profile joins |
| `src/hooks/__tests__/useCalendarAssignments.test.ts` | Create | Tests for the hook |
| `src/components/calendar/WeeklyCalendarGrid.tsx` | Create | Shared 7×3 grid component; tested through page tests |
| `src/pages/player/calendar/WeeklyCalendarPage.tsx` | Create | Player view with pin dialog + reminder toggles |
| `src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx` | Create | Tests for player page |
| `src/pages/admin/calendar/WeeklyCalendarPage.tsx` | Create | Admin read-only calendar view |
| `src/pages/admin/calendar/__tests__/WeeklyCalendarPage.test.tsx` | Create | Tests for admin page |
| `src/router.tsx` | Modify | Add `/player/calendar` and `/admin/calendar` routes |
| `src/components/layout/PlayerLayout.tsx` | Modify | Add "לוח שבועי" nav link |
| `src/components/layout/AdminLayout.tsx` | Modify | Add "לוח שבועי" nav link |

---

## Context for Implementers

### Existing Patterns to Follow

**Hook pattern** (`mountedRef` + `useCallback` + two `useEffect`s):
```typescript
export function useCalendarAssignments(): UseCalendarAssignmentsResult {
  const [assignments, setAssignments] = useState<AssignmentWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchAssignments = useCallback(async () => {
    setLoading(true)
    setError(null)
    // ... fetch ...
    if (!mountedRef.current) return
    // ... setState ...
    setLoading(false)
  }, [])

  useEffect(() => { fetchAssignments() }, [fetchAssignments])

  return { assignments, loading, error, refetch: fetchAssignments }
}
```

**Hook test pattern** (from `src/hooks/__tests__/usePendingRedemptions.test.ts`):
```typescript
function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),   // handles multiple .eq() calls
    order: vi.fn().mockResolvedValue(result),
  }
}
```

**Page test pattern** (from `src/pages/player/store/__tests__/RewardStorePage.test.tsx`):
```typescript
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

vi.mock('../../../../hooks/useCalendarAssignments', () => ({
  useCalendarAssignments: vi.fn(() => ({ assignments: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', name: 'דנה' } }),
}))

// Mutation mock pattern (update chain):
mockFrom.mockReturnValue({
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockResolvedValue({ error: null }),
})
```

**Dialog pattern** (from `src/pages/player/store/RewardStorePage.tsx`):
```tsx
<Dialog open={!!pinTarget} onOpenChange={open => { if (!open) setPinTarget(null) }}>
  <DialogContent dir="rtl">
    <DialogHeader><DialogTitle>קבע זמן למשימה</DialogTitle></DialogHeader>
    {/* content */}
    <DialogFooter className="gap-2">
      <Button variant="outline" onClick={() => setPinTarget(null)}>ביטול</Button>
      <Button onClick={submitPin} disabled={pinSaving}>{pinSaving ? 'שומר...' : 'שמור'}</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Select pattern** (from `src/pages/admin/chores/ChoreFormPage.tsx`):
```tsx
<Select value={pinDay} onValueChange={setPinDay}>
  <SelectTrigger aria-label="יום"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="0">ראשון</SelectItem>
    {/* ... */}
  </SelectContent>
</Select>
```

### Types to Know

From `src/types/database.ts`:
```typescript
export type CalendarSlot = 'morning' | 'noon' | 'afternoon'
export type AssignmentStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'failed'

export interface ChoreAssignment {
  id: string
  chore_id: string
  user_id: string
  week_start: string
  calendar_day: number | null   // 0=Sun, 1=Mon, ..., 6=Sat
  calendar_slot: CalendarSlot | null
  reminder_enabled: boolean
  status: AssignmentStatus
  archived: boolean
  created_at: string
  updated_at: string
}
```

### Running Tests
```bash
cd D:/Claude_Projects/family-chores
npx vitest run --reporter=verbose
```

---

## Task 1: `useCalendarAssignments` Hook

**Files:**
- Create: `src/hooks/useCalendarAssignments.ts`
- Create: `src/hooks/__tests__/useCalendarAssignments.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/hooks/__tests__/useCalendarAssignments.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useCalendarAssignments } from '../useCalendarAssignments'

const fakeAssignment = {
  id: 'a1',
  chore_id: 'c1',
  user_id: 'u1',
  week_start: '2026-03-29',
  calendar_day: 1,
  calendar_slot: 'morning' as const,
  reminder_enabled: false,
  status: 'pending' as const,
  archived: false,
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T10:00:00Z',
  chores: { title: 'כלים', coin_value: 10 },
  profiles: { name: 'דנה', avatar_url: null },
}

function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

describe('useCalendarAssignments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useCalendarAssignments())
    expect(result.current.loading).toBe(true)
    expect(result.current.assignments).toEqual([])
  })

  it('returns assignments with chore and profile details', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeAssignment], error: null }))
    const { result } = renderHook(() => useCalendarAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.assignments).toEqual([fakeAssignment])
    expect(result.current.error).toBeNull()
  })

  it('sets error on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאה' } }))
    const { result } = renderHook(() => useCalendarAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאה')
    expect(result.current.assignments).toEqual([])
  })

  it('refetch re-queries', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeAssignment], error: null }))
    const { result } = renderHook(() => useCalendarAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockFrom.mockReturnValue(makeFromMock({ data: [], error: null }))
    result.current.refetch()
    await waitFor(() => expect(result.current.assignments).toEqual([]))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/useCalendarAssignments.test.ts --reporter=verbose
```
Expected: FAIL — `useCalendarAssignments` not found.

- [ ] **Step 3: Write the hook**

```typescript
// src/hooks/useCalendarAssignments.ts
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentWeekStart } from '../lib/weekStart'
import type { ChoreAssignment } from '../types/database'

export interface AssignmentWithDetails extends ChoreAssignment {
  chores: { title: string; coin_value: number }
  profiles: { name: string; avatar_url: string | null }
}

export interface UseCalendarAssignmentsResult {
  assignments: AssignmentWithDetails[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useCalendarAssignments(): UseCalendarAssignmentsResult {
  const [assignments, setAssignments] = useState<AssignmentWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchAssignments = useCallback(async () => {
    setLoading(true)
    setError(null)
    const weekStart = getCurrentWeekStart()
    const { data, error } = await supabase
      .from('chore_assignments')
      .select('*, chores!inner(title, coin_value), profiles!user_id(name, avatar_url)')
      .eq('week_start', weekStart)
      .eq('archived', false)
      .order('created_at', { ascending: true })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setAssignments((data as AssignmentWithDetails[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAssignments() }, [fetchAssignments])

  return { assignments, loading, error, refetch: fetchAssignments }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/hooks/__tests__/useCalendarAssignments.test.ts --reporter=verbose
```
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCalendarAssignments.ts src/hooks/__tests__/useCalendarAssignments.test.ts
git commit -m "feat: add useCalendarAssignments hook with chore+profile joins"
```

---

## Task 2: `WeeklyCalendarGrid` Shared Component

**Files:**
- Create: `src/components/calendar/WeeklyCalendarGrid.tsx`

This component is purely presentational. It renders a 7-day × 3-slot grid with pinned assignments only. Own assignments have "שנה זמן" and "הסר" buttons plus a reminder checkbox. Other players' assignments are read-only. Tested through the page tests in Tasks 3 and 4.

- [ ] **Step 1: Create the grid component**

```typescript
// src/components/calendar/WeeklyCalendarGrid.tsx
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
  // Stable colour per user — first seen = first colour
  const userIds = [...new Set(assignments.map(a => a.user_id))]
  const colorMap: Record<string, string> = {}
  userIds.forEach((id, i) => {
    colorMap[id] = MEMBER_COLORS[i % MEMBER_COLORS.length]
  })

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
    const isOwn = a.user_id === currentUserId
    const color = colorMap[a.user_id] ?? 'bg-gray-100 border-gray-300'
    return (
      <div key={a.id} className={`rounded border p-1.5 text-xs space-y-1 ${color}`}>
        <div className="flex items-center gap-1">
          <Avatar className="h-5 w-5">
            <AvatarImage src={a.profiles.avatar_url ?? undefined} />
            <AvatarFallback className="text-[10px]">{a.profiles.name[0]}</AvatarFallback>
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

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* Header row: empty corner + 7 day labels */}
        <div className="grid grid-cols-8 gap-1 mb-1">
          <div />
          {DAYS.map(day => (
            <div
              key={day.index}
              className="text-center text-xs font-semibold text-muted-foreground py-1"
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
                {cellAssignments(day.index, slot.key).map(a => renderCard(a))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/calendar/WeeklyCalendarGrid.tsx
git commit -m "feat: add WeeklyCalendarGrid shared component"
```

---

## Task 3: Player `WeeklyCalendarPage`

**Files:**
- Create: `src/pages/player/calendar/WeeklyCalendarPage.tsx`
- Create: `src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'
import type { AssignmentWithDetails } from '../../../../hooks/useCalendarAssignments'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useCalendarAssignments', () => ({
  useCalendarAssignments: vi.fn(() => ({
    assignments: [],
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', name: 'דנה' } }),
}))

import { useCalendarAssignments } from '../../../../hooks/useCalendarAssignments'
import WeeklyCalendarPage from '../WeeklyCalendarPage'

const mockUseCalendarAssignments = vi.mocked(useCalendarAssignments)

const ownPinned: AssignmentWithDetails = {
  id: 'a1', chore_id: 'c1', user_id: 'u1',
  week_start: '2026-03-29', calendar_day: 1, calendar_slot: 'morning',
  reminder_enabled: false, status: 'pending', archived: false,
  created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z',
  chores: { title: 'כלים', coin_value: 10 },
  profiles: { name: 'דנה', avatar_url: null },
}

const ownUnscheduled: AssignmentWithDetails = {
  ...ownPinned, id: 'a2', calendar_day: null, calendar_slot: null,
  chores: { title: 'שקים', coin_value: 5 },
}

const otherPinned: AssignmentWithDetails = {
  ...ownPinned, id: 'a3', user_id: 'u2', calendar_day: 2, calendar_slot: 'afternoon',
  chores: { title: 'אבק', coin_value: 8 },
  profiles: { name: 'תום', avatar_url: null },
}

function renderPage() {
  return render(<MemoryRouter><WeeklyCalendarPage /></MemoryRouter>)
}

describe('Player WeeklyCalendarPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading state', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [], loading: true, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows own unscheduled assignments in "ללא סידור" section with pin button', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('ללא סידור')).toBeInTheDocument()
    expect(screen.getByText('שקים')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'קבע זמן' })).toBeInTheDocument()
  })

  it('opens pin dialog when "קבע זמן" is clicked', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'קבע זמן' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'קבע זמן למשימה' })).toBeInTheDocument()
  })

  it('submits pin with selected day and slot, then calls refetch', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    const mockUpdateFn = vi.fn().mockReturnThis()
    const mockEqFn = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ update: mockUpdateFn, eq: mockEqFn })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'קבע זמן' }))
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('chore_assignments')
      expect(mockRefetch).toHaveBeenCalled()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows error in dialog when pin save fails', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'קבע זמן' }))
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בקביעת הזמן')
    )
  })

  it('cancels pin dialog without saving', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'קבע זמן' }))
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }))

    expect(mockFrom).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"הסר" button unpins own assignment', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownPinned], loading: false, error: null, refetch: mockRefetch,
    })
    const mockUpdateFn = vi.fn().mockReturnThis()
    const mockEqFn = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ update: mockUpdateFn, eq: mockEqFn })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'הסר' }))

    await waitFor(() => {
      expect(mockUpdateFn).toHaveBeenCalledWith({ calendar_day: null, calendar_slot: null })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('reminder checkbox toggles reminder_enabled on own assignment', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    const mockUpdateFn = vi.fn().mockReturnThis()
    const mockEqFn = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ update: mockUpdateFn, eq: mockEqFn })
    renderPage()

    // ownUnscheduled.reminder_enabled = false → toggling sets to true
    await userEvent.click(screen.getByRole('checkbox', { name: 'תזכורת' }))

    await waitFor(() => {
      expect(mockUpdateFn).toHaveBeenCalledWith({ reminder_enabled: true })
    })
  })

  it('does not show pin/unpin/reminder controls for other players\' assignments', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [otherPinned], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('אבק')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'קבע זמן' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הסר' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'תזכורת' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx --reporter=verbose
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the player page**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx --reporter=verbose
```
Expected: 8 PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/player/calendar/WeeklyCalendarPage.tsx src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx
git commit -m "feat: add player weekly calendar page with pin dialog and reminder toggle"
```

---

## Task 4: Admin Calendar Page + Routing + Nav

**Files:**
- Create: `src/pages/admin/calendar/WeeklyCalendarPage.tsx`
- Create: `src/pages/admin/calendar/__tests__/WeeklyCalendarPage.test.tsx`
- Modify: `src/router.tsx`
- Modify: `src/components/layout/PlayerLayout.tsx`
- Modify: `src/components/layout/AdminLayout.tsx`

- [ ] **Step 1: Write the failing tests for the admin page**

```typescript
// src/pages/admin/calendar/__tests__/WeeklyCalendarPage.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { AssignmentWithDetails } from '../../../../hooks/useCalendarAssignments'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useCalendarAssignments', () => ({
  useCalendarAssignments: vi.fn(() => ({
    assignments: [],
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))

import { useCalendarAssignments } from '../../../../hooks/useCalendarAssignments'
import AdminCalendarPage from '../WeeklyCalendarPage'

const mockUseCalendarAssignments = vi.mocked(useCalendarAssignments)

const playerAssignment: AssignmentWithDetails = {
  id: 'a1', chore_id: 'c1', user_id: 'u1',
  week_start: '2026-03-29', calendar_day: 3, calendar_slot: 'noon',
  reminder_enabled: false, status: 'pending', archived: false,
  created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z',
  chores: { title: 'כלים', coin_value: 10 },
  profiles: { name: 'דנה', avatar_url: null },
}

function renderPage() {
  return render(<MemoryRouter><AdminCalendarPage /></MemoryRouter>)
}

describe('Admin WeeklyCalendarPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading state', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [], loading: true, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows error message on fetch failure', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [], loading: false, error: 'שגיאה', refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאה')
  })

  it('renders the calendar grid with day headers', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('ראשון')).toBeInTheDocument()
    expect(screen.getByText('שבת')).toBeInTheDocument()
  })

  it('shows a player assignment in the correct grid cell', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [playerAssignment], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('כלים')).toBeInTheDocument()
  })

  it('does not render any pin or reminder controls', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [playerAssignment], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.queryByRole('button', { name: 'שנה זמן' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הסר' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'תזכורת' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/pages/admin/calendar/__tests__/WeeklyCalendarPage.test.tsx --reporter=verbose
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the admin page**

```typescript
// src/pages/admin/calendar/WeeklyCalendarPage.tsx
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
```

- [ ] **Step 4: Run admin tests to verify they pass**

```bash
npx vitest run src/pages/admin/calendar/__tests__/WeeklyCalendarPage.test.tsx --reporter=verbose
```
Expected: 5 PASS

- [ ] **Step 5: Add routes to `src/router.tsx`**

Add these imports at the top with the other page imports:
```typescript
import PlayerCalendarPage from './pages/player/calendar/WeeklyCalendarPage'
import AdminCalendarPage from './pages/admin/calendar/WeeklyCalendarPage'
```

Add to the `/player` children array (after `'store'` route):
```typescript
{ path: 'calendar', element: <PlayerCalendarPage /> },
```

Add to the `/admin` children array (after `'redemptions'` route):
```typescript
{ path: 'calendar', element: <AdminCalendarPage /> },
```

- [ ] **Step 6: Add nav link to `src/components/layout/PlayerLayout.tsx`**

Add after the `<NavLink to="/player/store">` block, before `</nav>`:
```tsx
<NavLink
  to="/player/calendar"
  className={({ isActive }) =>
    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
  }
>
  לוח שבועי
</NavLink>
```

- [ ] **Step 7: Add nav link to `src/components/layout/AdminLayout.tsx`**

Add after the `<NavLink to="/admin/redemptions">` block, before `</nav>`:
```tsx
<NavLink
  to="/admin/calendar"
  className={({ isActive }) =>
    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
  }
>
  לוח שבועי
</NavLink>
```

- [ ] **Step 8: Run all tests to verify nothing is broken**

```bash
npx vitest run --reporter=verbose
```
Expected: all tests pass (previously 117 + 13 new = 130 tests)

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add src/pages/admin/calendar/WeeklyCalendarPage.tsx src/pages/admin/calendar/__tests__/WeeklyCalendarPage.test.tsx src/router.tsx src/components/layout/PlayerLayout.tsx src/components/layout/AdminLayout.tsx
git commit -m "feat: add admin calendar page and wire up routes and nav links"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| Shared family calendar visible to all players and admins | Tasks 3 + 4 |
| Week runs Sunday–Saturday (Israeli standard) | `DAYS` array in Task 2 |
| 3 time slots per day (morning/noon/afternoon) | `SLOTS` array in Task 2 |
| Players pin chore assignments to day + time slot | Task 3 (pin dialog + submitPin) |
| Cards show player avatar, chore title, status | Task 2 (`renderCard`) |
| Colour-coded per player | Task 2 (`MEMBER_COLORS` / `colorMap`) |
| Players can only manage own pins; all can view | Task 3 (currentUserId guard in WeeklyCalendarGrid) |
| Reminder toggle on any assignment | Task 3 (handleToggleReminder) |
| In-app reminders (push = future scope) | Toggle persisted; no scheduled job (future) |

**Type consistency check:**
- `AssignmentWithDetails` defined in Task 1, imported in Tasks 2, 3, 4 ✅
- `DAYS` and `SLOTS` exported from Task 2 and imported in Task 3 ✅
- `CalendarSlot` type from `database.ts` used consistently ✅
- `onChangePin` prop name matches usage in all components ✅
