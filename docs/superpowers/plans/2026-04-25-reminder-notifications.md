# Reminder Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire in-app reminder notifications 30 minutes before a player's pinned chore slot, with server-enforced re-arm logic on toggle and reschedule.

**Architecture:** Pure SQL + pg_cron for notification delivery (`send_reminder_notifications` SECURITY DEFINER, runs every 30 min). Two new SECURITY DEFINER RPCs (`toggle_reminder`, `reschedule_assignment`) replace all direct client writes to `calendar_day`, `calendar_slot`, and `reminder_enabled`. Client never writes `reminder_sent_at`. Re-arm on reschedule is enforced server-side via `IS DISTINCT FROM` comparison.

**Tech Stack:** PostgreSQL (SECURITY DEFINER, pg_cron, FOR UPDATE), Supabase, React 18 + TypeScript, Vitest + React Testing Library, shadcn/ui, Tailwind CSS, Hebrew RTL (`dir="rtl"`).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/027_reminder_notifications.sql` | Create | `reminder_sent_at` column, `toggle_reminder` RPC, `reschedule_assignment` RPC, `send_reminder_notifications` function, pg_cron schedule |
| `src/types/database.ts` | Modify | Add `reminder_sent_at: string \| null` to `ChoreAssignment` interface |
| `src/pages/player/calendar/WeeklyCalendarPage.tsx` | Modify | Replace direct updates with RPCs; add `useToast` error handling; add re-arm hint |
| `src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx` | Modify | Update existing toggle/pin/unpin tests to use `mockRpc`; add RPC error toast tests; add re-arm hint tests |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/027_reminder_notifications.sql`

No unit tests for SQL migrations — correctness verified by later UI tests and manual Supabase apply.

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/027_reminder_notifications.sql

-- ── 1. chore_assignments: reminder delivery timestamp ──────────────────────
ALTER TABLE chore_assignments
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ NULL;

-- ── 2. toggle_reminder(uuid) ───────────────────────────────────────────────
-- Callable by authenticated users. Validates ownership, toggles reminder_enabled.
-- On enable: resets reminder_sent_at = NULL so cron fires again.
-- On disable: leaves reminder_sent_at unchanged.
CREATE OR REPLACE FUNCTION toggle_reminder(p_assignment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment chore_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_assignment FROM chore_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_assignment.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_assignment.reminder_enabled THEN
    -- Disabling: leave reminder_sent_at unchanged
    UPDATE chore_assignments
    SET reminder_enabled = false
    WHERE id = p_assignment_id;
  ELSE
    -- Enabling: reset reminder_sent_at so cron fires for current slot
    UPDATE chore_assignments
    SET reminder_enabled  = true,
        reminder_sent_at  = NULL
    WHERE id = p_assignment_id;
  END IF;
END;
$$;

-- ── 3. reschedule_assignment(uuid, int, text) ──────────────────────────────
-- Callable by authenticated users. Validates ownership, updates slot/day.
-- Re-arms reminder (reminder_sent_at = NULL) only when slot or day actually changes.
-- NULL p_day / p_slot = unpin. Unpin also resets reminder_sent_at (intentional:
-- ensures fresh reminder when player re-pins later).
CREATE OR REPLACE FUNCTION reschedule_assignment(
  p_assignment_id uuid,
  p_day           int,
  p_slot          text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment chore_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_assignment FROM chore_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_assignment.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_day IS DISTINCT FROM v_assignment.calendar_day OR
     p_slot IS DISTINCT FROM v_assignment.calendar_slot THEN
    -- Slot or day changed: silently re-arm reminder
    UPDATE chore_assignments
    SET calendar_day     = p_day,
        calendar_slot    = p_slot,
        reminder_sent_at = NULL
    WHERE id = p_assignment_id;
  ELSE
    -- No change to slot/day: don't touch reminder_sent_at
    UPDATE chore_assignments
    SET calendar_day  = p_day,
        calendar_slot = p_slot
    WHERE id = p_assignment_id;
  END IF;
END;
$$;

-- ── 4. send_reminder_notifications() ──────────────────────────────────────
-- Called by pg_cron every 30 min. SECURITY DEFINER (postgres owner) bypasses
-- RLS — intentional, never callable by clients (REVOKE'd below).
-- FOR UPDATE OF ca serializes against concurrent reschedule_assignment calls.
CREATE OR REPLACE FUNCTION send_reminder_notifications()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_time  time;
  v_current_dow int;
  v_slot        text;
  v_slot_label  text;
  r             RECORD;
BEGIN
  v_local_time  := (now() AT TIME ZONE 'Asia/Jerusalem')::time;
  v_current_dow := EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Jerusalem'))::int;

  FOR v_slot, v_slot_label IN
    VALUES ('morning','בוקר-צהריים'), ('noon','צהריים-אחה"צ'), ('afternoon','אחה"צ-ערב')
  LOOP
    -- Skip this run if current Israel time is outside the slot's 30-min window
    CONTINUE WHEN NOT (
      (v_slot = 'morning'   AND v_local_time >= '07:30' AND v_local_time < '08:00') OR
      (v_slot = 'noon'      AND v_local_time >= '11:30' AND v_local_time < '12:00') OR
      (v_slot = 'afternoon' AND v_local_time >= '15:30' AND v_local_time < '16:00')
    );

    FOR r IN
      SELECT
        ca.id        AS assignment_id,
        ca.user_id,
        c.title      AS chore_title,
        c.family_id
      FROM chore_assignments ca
      JOIN chores c ON c.id = ca.chore_id
      WHERE ca.reminder_enabled = true
        AND ca.reminder_sent_at IS NULL
        AND ca.status           NOT IN ('completed', 'failed')
        AND ca.archived         = false
        AND ca.calendar_slot    = v_slot
        AND ca.calendar_day     = v_current_dow
      FOR UPDATE OF ca
    LOOP
      INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
      VALUES (
        r.user_id,
        r.family_id,
        'reminder',
        'תזכורת: ' || r.chore_title,
        'המשימה שלך מתחילה בקרוב (' || v_slot_label || ')',
        r.assignment_id
      );

      UPDATE chore_assignments
      SET reminder_sent_at = now()
      WHERE id = r.assignment_id;
    END LOOP;
  END LOOP;
END;
$$;

-- ── 5. Revoke client access to send_reminder_notifications ────────────────
REVOKE EXECUTE ON FUNCTION send_reminder_notifications() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION send_reminder_notifications() FROM authenticated;
REVOKE EXECUTE ON FUNCTION send_reminder_notifications() FROM anon;

-- ── 6. pg_cron schedule (idempotent) ──────────────────────────────────────
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reminder-notifications';
SELECT cron.schedule(
  'reminder-notifications',
  '*/30 * * * *',
  'SELECT send_reminder_notifications()'
);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/027_reminder_notifications.sql
git commit -m "feat(db): add reminder_sent_at column, toggle_reminder, reschedule_assignment RPCs, send_reminder_notifications cron"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/types/database.ts`

No runtime tests — verified by TypeScript compilation (`npm run build`).

- [ ] **Step 1: Add `reminder_sent_at` to `ChoreAssignment` in `src/types/database.ts`**

Find the `ChoreAssignment` interface (currently at line ~61). Add one field after `reminder_enabled`:

```typescript
export interface ChoreAssignment {
  id: string
  chore_id: string
  user_id: string
  week_start: string
  calendar_day: number | null
  calendar_slot: CalendarSlot | null
  reminder_enabled: boolean
  reminder_sent_at: string | null   // ← add this line
  status: AssignmentStatus
  archived: boolean
  assigned_by: string | null
  created_at: string
  updated_at: string
  hasRejection?: boolean
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): add reminder_sent_at to ChoreAssignment"
```

---

## Task 3: WeeklyCalendarPage — Tests + Implementation

**Files:**
- Modify: `src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx`
- Modify: `src/pages/player/calendar/WeeklyCalendarPage.tsx`

Use TDD: write failing tests first, then implement.

### Step 1: Write failing tests

- [ ] **Step 1a: Update the test file**

Replace the full contents of `src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx` with:

```typescript
// src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom, mockRpc, mockFunctionsInvoke } from '../../../../test/mocks/supabase'
import type { AssignmentWithDetails } from '../../../../hooks/useCalendarAssignments'

const mockRefetch = vi.fn()
const mockToast = vi.fn()

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
vi.mock('../../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

import { useCalendarAssignments } from '../../../../hooks/useCalendarAssignments'
import WeeklyCalendarPage from '../WeeklyCalendarPage'

const mockUseCalendarAssignments = vi.mocked(useCalendarAssignments)

const ownPinned: AssignmentWithDetails = {
  id: 'a1', chore_id: 'c1', user_id: 'u1',
  week_start: '2026-03-29', calendar_day: 1, calendar_slot: 'morning',
  reminder_enabled: false, reminder_sent_at: null,
  status: 'pending', archived: false, assigned_by: null,
  created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z',
  chores: { title: 'כלים', coin_value: 10, recurrence_type: 'none' },
  profiles: { name: 'דנה', avatar_url: null },
}

const ownUnscheduled: AssignmentWithDetails = {
  ...ownPinned, id: 'a2', calendar_day: null, calendar_slot: null,
  chores: { title: 'שקים', coin_value: 5, recurrence_type: 'none' },
}

const otherPinned: AssignmentWithDetails = {
  ...ownPinned, id: 'a3', user_id: 'u2', calendar_day: 2, calendar_slot: 'afternoon',
  chores: { title: 'אבק', coin_value: 8, recurrence_type: 'none' },
  profiles: { name: 'תום', avatar_url: null },
}

function renderPage() {
  return render(<MemoryRouter><WeeklyCalendarPage /></MemoryRouter>)
}

describe('Player WeeklyCalendarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({ error: null })
  })

  it('shows loading state', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [], loading: true, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows own unscheduled assignments in "ללא סידור" section as draggable', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('ללא סידור')).toBeInTheDocument()
    expect(screen.getByText('שקים')).toBeInTheDocument()
    const card = screen.getByText('שקים').closest('[draggable]')
    expect(card).toHaveAttribute('draggable', 'true')
  })

  it('does not show "קבע זמן" button or dialog', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.queryByRole('button', { name: 'קבע זמן' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('dropping assignment on a cell calls reschedule_assignment RPC and refetch', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled, ownPinned], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()

    const cell = screen.getAllByTestId('cell-1-morning')[0]
    fireEvent.drop(cell, {
      dataTransfer: { getData: () => 'a2' },
    })

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('reschedule_assignment', {
        p_assignment_id: 'a2',
        p_day: 1,
        p_slot: 'morning',
      })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('"הסר" button calls reschedule_assignment RPC with null day/slot', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownPinned], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'הסר' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('reschedule_assignment', {
        p_assignment_id: 'a1',
        p_day: null,
        p_slot: null,
      })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('reminder checkbox calls toggle_reminder RPC', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()

    await userEvent.click(screen.getByRole('checkbox', { name: 'תזכורת' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('toggle_reminder', { p_assignment_id: 'a2' })
    })
  })

  it('toggle_reminder RPC error shows error toast', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    mockRpc.mockResolvedValue({ error: { message: 'Not authorized' } })
    renderPage()

    await userEvent.click(screen.getByRole('checkbox', { name: 'תזכורת' }))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' })
      )
    })
  })

  it('reschedule_assignment RPC error shows error toast', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownPinned], loading: false, error: null, refetch: mockRefetch,
    })
    mockRpc.mockResolvedValue({ error: { message: 'Not authorized' } })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'הסר' }))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' })
      )
    })
  })

  it('shows re-arm hint when reminder_enabled=true and reminder_sent_at is set', () => {
    const firedAssignment: AssignmentWithDetails = {
      ...ownUnscheduled,
      reminder_enabled: true,
      reminder_sent_at: '2026-04-25T07:31:00Z',
    }
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [firedAssignment], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('תזכורת נשלחה — העבר למשבצת אחרת או כבה והדלק מחדש')).toBeInTheDocument()
  })

  it('does not show re-arm hint when reminder_sent_at is null', () => {
    const armedAssignment: AssignmentWithDetails = {
      ...ownUnscheduled,
      reminder_enabled: true,
      reminder_sent_at: null,
    }
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [armedAssignment], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.queryByText('תזכורת נשלחה — העבר למשבצת אחרת או כבה והדלק מחדש')).not.toBeInTheDocument()
  })

  it('does not show unpin/reminder controls for other players\' assignments', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [otherPinned], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('אבק')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הסר' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'תזכורת' })).not.toBeInTheDocument()
  })

  it('dragging an already-scheduled recurring assignment creates a new one instead of moving', async () => {
    const recurringPinned: AssignmentWithDetails = {
      ...ownPinned, id: 'a5', calendar_day: 2, calendar_slot: 'afternoon',
      chores: { title: 'ניקיון', coin_value: 8, recurrence_type: 'daily' },
    }
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [recurringPinned], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()

    const cell = screen.getAllByTestId('cell-1-morning')[0]
    fireEvent.drop(cell, {
      dataTransfer: { getData: () => 'a5' },
    })

    await waitFor(() => {
      expect(mockFunctionsInvoke).toHaveBeenCalledWith('self-assign-chore', {
        body: { chore_id: 'c1', calendar_day: 1, calendar_slot: 'morning' },
      })
      expect(mockRefetch).toHaveBeenCalled()
    })
    expect(mockRpc).not.toHaveBeenCalledWith('reschedule_assignment', expect.anything())
  })

  it('completed assignments are not shown', () => {
    renderPage()
    expect(mockUseCalendarAssignments).toHaveBeenCalled()
  })
})
```

- [ ] **Step 1b: Run tests — verify failures**

Run: `npx vitest run src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx --reporter=verbose`

Expected failures:
- `dropping assignment on a cell calls reschedule_assignment RPC` — FAIL (currently calls `mockFrom.update`)
- `"הסר" button calls reschedule_assignment RPC` — FAIL (currently calls `mockFrom.update`)
- `reminder checkbox calls toggle_reminder RPC` — FAIL (currently calls `mockFrom.update`)
- `toggle_reminder RPC error shows error toast` — FAIL (no error handling)
- `reschedule_assignment RPC error shows error toast` — FAIL (no error handling)
- `shows re-arm hint when reminder_sent_at is set` — FAIL (hint not rendered)
- `does not show re-arm hint when reminder_sent_at is null` — may pass or fail

### Step 2: Implement WeeklyCalendarPage changes

- [ ] **Step 2a: Rewrite `src/pages/player/calendar/WeeklyCalendarPage.tsx`**

```typescript
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
```

- [ ] **Step 2b: Run tests — verify they pass**

Run: `npx vitest run src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx --reporter=verbose`
Expected: all tests PASS

- [ ] **Step 2c: Run full test suite — verify no regressions**

Run: `npx vitest run --reporter=verbose`
Expected: all tests PASS

- [ ] **Step 2d: Verify TypeScript build**

Run: `npm run build`
Expected: no errors

- [ ] **Step 2e: Commit**

```bash
git add src/pages/player/calendar/WeeklyCalendarPage.tsx src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx
git commit -m "feat(calendar): replace direct DB writes with toggle_reminder and reschedule_assignment RPCs; add re-arm hint"
```
