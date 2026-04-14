# Recurring Chores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily/weekly/monthly recurrence to chores with a unified schedule table, auto-population of weekly assignments via client-triggered RPC, and schedule management UI in ChoreFormPage.

**Architecture:** A new `chore_schedule` table stores per-player, per-day assignments for all recurrence types. A `populate_weekly_assignments` Supabase RPC creates assignments idempotently each week. A `useWeeklyPopulation` React hook calls the RPC once per week on dashboard load via localStorage. ChoreFormPage gains a recurrence selector and schedule grid UI.

**Tech Stack:** React, TypeScript, Vitest + @testing-library/react, Supabase JS client, PostgreSQL (migration runs in Supabase SQL Editor)

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/014_recurring_chores.sql` | Create — migration: recurrence_type, chore_schedule, unique constraint, RPC |
| `src/types/database.ts` | Modify — replace `is_recurring`, add `RecurrenceType`, add `ChoreSchedule` |
| `src/hooks/__tests__/useChores.test.ts` | Modify — update fixture: `is_recurring` → `recurrence_type` |
| `src/pages/admin/chores/__tests__/ChoresPage.test.tsx` | Modify — update fixture |
| `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx` | Modify — update fixture + add schedule mock |
| `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx` | Modify — update fixture |
| `src/pages/player/__tests__/PlayerDashboard.test.tsx` | Modify — update fixture + mock useWeeklyPopulation |
| `src/hooks/useWeeklyPopulation.ts` | Create — idempotent weekly population hook |
| `src/hooks/__tests__/useWeeklyPopulation.test.ts` | Create — tests for the hook |
| `src/pages/player/PlayerDashboard.tsx` | Modify — add `useWeeklyPopulation()` call |
| `src/pages/admin/AdminDashboard.tsx` | Modify — add `useWeeklyPopulation()` call |
| `src/pages/admin/chores/ChoreFormPage.tsx` | Modify — recurrence selector + schedule grid UI |

---

### Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/014_recurring_chores.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/014_recurring_chores.sql` with the following content:

```sql
-- ============================================================
-- PART 1: Replace is_recurring with recurrence_type on chores
-- ============================================================
ALTER TABLE chores
  ADD COLUMN recurrence_type TEXT NOT NULL DEFAULT 'none'
    CHECK (recurrence_type IN ('none', 'weekly', 'daily', 'monthly'));

UPDATE chores SET recurrence_type = 'weekly' WHERE is_recurring = true;

ALTER TABLE chores DROP COLUMN is_recurring;

-- ============================================================
-- PART 2: chore_schedule table
-- ============================================================
CREATE TABLE IF NOT EXISTS chore_schedule (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chore_id     UUID NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  day_of_week  INTEGER CHECK (day_of_week BETWEEN 0 AND 6), -- NULL = weekly/monthly
  assigned_to  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (chore_id, assigned_to, day_of_week)
);

ALTER TABLE chore_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chore_schedule: family members can read"
  ON chore_schedule FOR SELECT
  USING (chore_id IN (
    SELECT id FROM chores WHERE family_id = get_my_family_id()
  ));

CREATE POLICY "chore_schedule: admins can write"
  ON chore_schedule FOR ALL
  USING (
    chore_id IN (SELECT id FROM chores WHERE family_id = get_my_family_id())
    AND is_admin()
  );

-- ============================================================
-- PART 3: Unique constraint on chore_assignments
-- Prevents same player getting same chore/day twice,
-- but allows multiple players on the same chore/day.
-- ============================================================
ALTER TABLE chore_assignments
  ADD CONSTRAINT chore_assignments_unique_player_slot
  UNIQUE NULLS NOT DISTINCT (chore_id, user_id, week_start, calendar_day);

-- ============================================================
-- PART 4: populate_weekly_assignments RPC
-- ============================================================
CREATE OR REPLACE FUNCTION populate_weekly_assignments(p_week_start date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_family_id uuid;
  v_sched     RECORD;
BEGIN
  v_family_id := get_my_family_id();
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'no_family'; END IF;

  -- Weekly: one assignment per scheduled player (day_of_week IS NULL)
  FOR v_sched IN
    SELECT cs.assigned_to, cs.chore_id
    FROM chore_schedule cs
    JOIN chores c ON c.id = cs.chore_id
    WHERE c.family_id = v_family_id
      AND c.recurrence_type = 'weekly'
      AND c.status = 'active'
      AND cs.day_of_week IS NULL
  LOOP
    INSERT INTO chore_assignments (chore_id, user_id, week_start)
    VALUES (v_sched.chore_id, v_sched.assigned_to, p_week_start)
    ON CONFLICT ON CONSTRAINT chore_assignments_unique_player_slot DO NOTHING;
  END LOOP;

  -- Daily: one assignment per scheduled player per day
  FOR v_sched IN
    SELECT cs.assigned_to, cs.chore_id, cs.day_of_week
    FROM chore_schedule cs
    JOIN chores c ON c.id = cs.chore_id
    WHERE c.family_id = v_family_id
      AND c.recurrence_type = 'daily'
      AND c.status = 'active'
      AND cs.day_of_week IS NOT NULL
  LOOP
    INSERT INTO chore_assignments (chore_id, user_id, week_start, calendar_day)
    VALUES (v_sched.chore_id, v_sched.assigned_to, p_week_start, v_sched.day_of_week)
    ON CONFLICT ON CONSTRAINT chore_assignments_unique_player_slot DO NOTHING;
  END LOOP;

  -- Monthly: label only, no auto-creation
END;
$$;
```

- [ ] **Step 2: Run the migration in Supabase SQL Editor**

Copy the entire contents of `supabase/migrations/014_recurring_chores.sql` and run it in the Supabase project SQL Editor.

Expected: no errors. If you get "column is_recurring does not exist", the column was already removed — ignore and continue.

- [ ] **Step 3: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add supabase/migrations/014_recurring_chores.sql
git commit -m "feat: add recurring chores migration (recurrence_type, chore_schedule, RPC)"
```

---

### Task 2: TypeScript Types + Fix All Mock Fixtures

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/hooks/__tests__/useChores.test.ts`
- Modify: `src/pages/admin/chores/__tests__/ChoresPage.test.tsx`
- Modify: `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx`
- Modify: `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx`
- Modify: `src/pages/player/__tests__/PlayerDashboard.test.tsx`

- [ ] **Step 1: Update `src/types/database.ts`**

Find the `Chore` interface and the line `is_recurring: boolean`. Replace it:

```typescript
// Remove this line:
is_recurring: boolean

// Add this line in its place:
recurrence_type: RecurrenceType
```

Also add the new type and interface. Find the line `export type CoinReason = ...` and add these lines immediately before it:

```typescript
export type RecurrenceType = 'none' | 'weekly' | 'daily' | 'monthly'
```

At the end of the file, add:

```typescript
export interface ChoreSchedule {
  id: string
  chore_id: string
  day_of_week: number | null  // null = weekly/monthly, 0–6 (0=Sun) = daily
  assigned_to: string
}
```

- [ ] **Step 2: Update `src/hooks/__tests__/useChores.test.ts`**

Find `is_recurring: false` in `fakeChore` (line 15) and replace with:

```typescript
recurrence_type: 'none' as const,
```

- [ ] **Step 3: Update `src/pages/admin/chores/__tests__/ChoresPage.test.tsx`**

Find `is_recurring: false` in `activeChore` (line 30) and replace with:

```typescript
recurrence_type: 'none' as const,
```

- [ ] **Step 4: Update `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx`**

Find `is_recurring: false` in `existingChore` (line 50) and replace with:

```typescript
recurrence_type: 'none',
```

- [ ] **Step 5: Update `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx`**

Find `is_recurring: false` in `openChore` (line 36). Replace with:

```typescript
recurrence_type: 'none' as const,
```

- [ ] **Step 6: Update `src/pages/player/__tests__/PlayerDashboard.test.tsx`**

Find `is_recurring: false` in `fakeChore` (line 42). Replace with:

```typescript
recurrence_type: 'none' as const,
```

- [ ] **Step 7: Run tests — confirm all pass**

```bash
cd D:/Claude_Projects/family-chores
npx vitest run
```

Expected: all tests pass. If TypeScript errors remain, search for any remaining `is_recurring` references:

```bash
grep -rn "is_recurring" src/ --include="*.ts" --include="*.tsx"
```

Fix any that appear.

- [ ] **Step 8: Commit**

```bash
git add src/types/database.ts \
  src/hooks/__tests__/useChores.test.ts \
  src/pages/admin/chores/__tests__/ChoresPage.test.tsx \
  src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx \
  src/pages/player/chores/__tests__/ChorePoolPage.test.tsx \
  src/pages/player/__tests__/PlayerDashboard.test.tsx
git commit -m "feat: replace is_recurring with recurrence_type in types and test fixtures"
```

---

### Task 3: `useWeeklyPopulation` Hook (TDD)

**Files:**
- Create: `src/hooks/__tests__/useWeeklyPopulation.test.ts`
- Create: `src/hooks/useWeeklyPopulation.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/__tests__/useWeeklyPopulation.test.ts`:

```typescript
import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockRpc } from '../../test/mocks/supabase'
import { useWeeklyPopulation } from '../useWeeklyPopulation'

const STORAGE_KEY = 'weeklyPopulated'
const FIXED_WEEK = '2026-04-06'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ profile: { id: 'u1', family_id: 'f1' } })),
}))

vi.mock('../../lib/weekStart', () => ({
  getCurrentWeekStart: vi.fn(() => FIXED_WEEK),
}))

describe('useWeeklyPopulation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockRpc.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('calls RPC with current week_start when no stored week', () => {
    renderHook(() => useWeeklyPopulation())
    expect(mockRpc).toHaveBeenCalledWith('populate_weekly_assignments', {
      p_week_start: FIXED_WEEK,
    })
  })

  it('does not call RPC when stored week matches current week', () => {
    localStorage.setItem(STORAGE_KEY, FIXED_WEEK)
    renderHook(() => useWeeklyPopulation())
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('calls RPC when stored week differs from current week', () => {
    localStorage.setItem(STORAGE_KEY, '2026-03-30')
    renderHook(() => useWeeklyPopulation())
    expect(mockRpc).toHaveBeenCalledWith('populate_weekly_assignments', {
      p_week_start: FIXED_WEEK,
    })
  })

  it('updates localStorage to current week after successful RPC', async () => {
    mockRpc.mockResolvedValue({ error: null })
    renderHook(() => useWeeklyPopulation())
    await vi.waitFor(() =>
      expect(localStorage.getItem(STORAGE_KEY)).toBe(FIXED_WEEK)
    )
  })

  it('does not call RPC when profile has no family_id', () => {
    const { useAuth } = vi.mocked(await import('../../contexts/AuthContext'))
    useAuth.mockReturnValueOnce({ profile: { id: 'u1', family_id: null } } as any)
    renderHook(() => useWeeklyPopulation())
    expect(mockRpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd D:/Claude_Projects/family-chores
npx vitest run src/hooks/__tests__/useWeeklyPopulation.test.ts
```

Expected: FAIL — `useWeeklyPopulation` does not exist yet.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useWeeklyPopulation.ts`:

```typescript
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentWeekStart } from '../lib/weekStart'

const STORAGE_KEY = 'weeklyPopulated'

export function useWeeklyPopulation(): void {
  const { profile } = useAuth()

  useEffect(() => {
    if (!profile?.family_id) return
    const currentWeek = getCurrentWeekStart()
    if (localStorage.getItem(STORAGE_KEY) === currentWeek) return
    supabase
      .rpc('populate_weekly_assignments', { p_week_start: currentWeek })
      .then(() => localStorage.setItem(STORAGE_KEY, currentWeek))
      .catch(err => console.error('[useWeeklyPopulation]', err))
  }, [profile?.family_id])
}
```

- [ ] **Step 4: Run tests — confirm all 5 pass**

```bash
npx vitest run src/hooks/__tests__/useWeeklyPopulation.test.ts
```

Expected:
```
✓ calls RPC with current week_start when no stored week
✓ does not call RPC when stored week matches current week
✓ calls RPC when stored week differs from current week
✓ updates localStorage to current week after successful RPC
✓ does not call RPC when profile has no family_id

Tests  5 passed (5)
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWeeklyPopulation.ts src/hooks/__tests__/useWeeklyPopulation.test.ts
git commit -m "feat: add useWeeklyPopulation hook for idempotent weekly assignment creation"
```

---

### Task 4: Wire `useWeeklyPopulation` into Dashboards

**Files:**
- Modify: `src/pages/player/PlayerDashboard.tsx`
- Modify: `src/pages/admin/AdminDashboard.tsx`
- Modify: `src/pages/player/__tests__/PlayerDashboard.test.tsx`
- Modify: `src/pages/admin/__tests__/AdminDashboard.test.tsx` (if it exists)

- [ ] **Step 1: Update `src/pages/player/PlayerDashboard.tsx`**

Add the import near the top (after other hook imports):

```typescript
import { useWeeklyPopulation } from '../../hooks/useWeeklyPopulation'
```

Inside `PlayerDashboard()`, add this call immediately after the existing hook calls (after `useActivityFeed`):

```typescript
useWeeklyPopulation()
```

- [ ] **Step 2: Update `src/pages/admin/AdminDashboard.tsx`**

Add the import near the top:

```typescript
import { useWeeklyPopulation } from '../../hooks/useWeeklyPopulation'
```

Inside `AdminDashboard()`, add this call after the existing hook calls:

```typescript
useWeeklyPopulation()
```

- [ ] **Step 3: Mock `useWeeklyPopulation` in PlayerDashboard test**

In `src/pages/player/__tests__/PlayerDashboard.test.tsx`, add this mock near the top with the other `vi.mock` calls:

```typescript
vi.mock('../../hooks/useWeeklyPopulation', () => ({
  useWeeklyPopulation: vi.fn(),
}))
```

- [ ] **Step 4: Run full test suite**

```bash
cd D:/Claude_Projects/family-chores
npx vitest run
```

Expected: all tests pass. If `AdminDashboard.test.tsx` exists and fails because of `useWeeklyPopulation`, add the same mock to it:

```typescript
vi.mock('../../hooks/useWeeklyPopulation', () => ({
  useWeeklyPopulation: vi.fn(),
}))
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/player/PlayerDashboard.tsx \
  src/pages/admin/AdminDashboard.tsx \
  src/pages/player/__tests__/PlayerDashboard.test.tsx
git commit -m "feat: wire useWeeklyPopulation into player and admin dashboards"
```

---

### Task 5: ChoreFormPage — Recurrence UI

**Files:**
- Modify: `src/pages/admin/chores/ChoreFormPage.tsx`
- Modify: `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx`

- [ ] **Step 1: Replace `ChoreFormPage.tsx` entirely**

Replace the entire contents of `src/pages/admin/chores/ChoreFormPage.tsx` with:

```typescript
import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useFamilyMembers } from '../../../hooks/useFamilyMembers'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Textarea } from '../../../components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import type { ChoreDifficulty, ChoreStatus, RecurrenceType } from '../../../types/database'

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

export default function ChoreFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = id !== undefined
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { members } = useFamilyMembers()

  const [title, setTitle]                   = useState('')
  const [description, setDescription]       = useState('')
  const [coinValue, setCoinValue]           = useState('1')
  const [difficulty, setDifficulty]         = useState<ChoreDifficulty>('easy')
  const [assignedTo, setAssignedTo]         = useState('none')
  const [dueDate, setDueDate]               = useState('')
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('none')
  // day_of_week (0–6) → user_id; only used when recurrenceType === 'daily'
  const [dailySchedule, setDailySchedule]   = useState<Record<number, string>>({})
  // list of user_ids; only used when recurrenceType === 'weekly' | 'monthly'
  const [weeklyAssignees, setWeeklyAssignees] = useState<string[]>([])
  const [saving, setSaving]                 = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  // Load chore data in edit mode
  useEffect(() => {
    if (!isEditMode) return
    supabase
      .from('chores')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setError('שגיאה בטעינת המשימה'); return }
        setTitle(data.title)
        setDescription(data.description ?? '')
        setCoinValue(String(data.coin_value))
        setDifficulty(data.difficulty as ChoreDifficulty)
        setAssignedTo(data.assigned_to ?? 'none')
        setDueDate(data.due_date ?? '')
        setRecurrenceType((data.recurrence_type as RecurrenceType) ?? 'none')
      })
  }, [id, isEditMode])

  // Load schedule in edit mode
  useEffect(() => {
    if (!isEditMode || !id) return
    supabase
      .from('chore_schedule')
      .select('*')
      .eq('chore_id', id)
      .then(({ data }) => {
        if (!data || data.length === 0) return
        if (data[0].day_of_week !== null) {
          const daily: Record<number, string> = {}
          for (const row of data) {
            if (row.day_of_week !== null) daily[row.day_of_week] = row.assigned_to
          }
          setDailySchedule(daily)
        } else {
          setWeeklyAssignees(data.map((r: { assigned_to: string }) => r.assigned_to))
        }
      })
  }, [id, isEditMode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      if (!profile?.family_id) { setError('שגיאה בשמירת המשימה'); return }

      const payload = {
        title,
        description: description || null,
        coin_value: Number(coinValue),
        difficulty,
        // assigned_to only used for non-recurring chores
        assigned_to: recurrenceType === 'none' && assignedTo !== 'none' ? assignedTo : null,
        due_date: dueDate || null,
        recurrence_type: recurrenceType,
      }

      let choreId: string
      if (isEditMode) {
        const { error: err } = await supabase.from('chores').update(payload).eq('id', id!)
        if (err) { setError('שגיאה בשמירת המשימה'); return }
        choreId = id!
      } else {
        const { data, error: err } = await supabase
          .from('chores')
          .insert({ ...payload, family_id: profile.family_id, status: 'active' as ChoreStatus })
          .select('id')
          .single()
        if (err || !data) { setError('שגיאה בשמירת המשימה'); return }
        choreId = data.id
      }

      // Save schedule for recurring chores
      if (recurrenceType !== 'none') {
        await supabase.from('chore_schedule').delete().eq('chore_id', choreId)
        const scheduleRows =
          recurrenceType === 'daily'
            ? Object.entries(dailySchedule)
                .filter(([, userId]) => userId && userId !== 'none')
                .map(([day, userId]) => ({
                  chore_id: choreId,
                  day_of_week: Number(day),
                  assigned_to: userId,
                }))
            : weeklyAssignees.map(userId => ({
                chore_id: choreId,
                day_of_week: null,
                assigned_to: userId,
              }))
        if (scheduleRows.length > 0) {
          const { error: schedErr } = await supabase.from('chore_schedule').insert(scheduleRows)
          if (schedErr) { setError('שגיאה בשמירת הלוח זמנים'); return }
        }
      }

      navigate('/admin/chores')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg" dir="rtl">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/chores">← חזרה</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isEditMode ? 'עריכת משימה' : 'משימה חדשה'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="title">שם המשימה</Label>
              <Input
                id="title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="description">תיאור</Label>
              <Textarea
                id="description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="coinValue">ערך במטבעות</Label>
              <Input
                id="coinValue"
                type="number"
                min={1}
                value={coinValue}
                onChange={e => setCoinValue(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label>רמת קושי</Label>
              <Select value={difficulty} onValueChange={v => setDifficulty(v as ChoreDifficulty)}>
                <SelectTrigger aria-label="רמת קושי">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">קל</SelectItem>
                  <SelectItem value="medium">בינוני</SelectItem>
                  <SelectItem value="hard">קשה</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {recurrenceType === 'none' && (
              <div className="space-y-1">
                <Label>שייך ל</Label>
                <Select value={assignedTo} onValueChange={setAssignedTo}>
                  <SelectTrigger aria-label="שייך ל">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">בריכה פתוחה (כולם)</SelectItem>
                    {members.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="dueDate">תאריך יעד (אופציונלי)</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label>חזרה</Label>
              <Select value={recurrenceType} onValueChange={v => setRecurrenceType(v as RecurrenceType)}>
                <SelectTrigger aria-label="סוג חזרה">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">ללא</SelectItem>
                  <SelectItem value="daily">יומי</SelectItem>
                  <SelectItem value="weekly">שבועי</SelectItem>
                  <SelectItem value="monthly">חודשי</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {recurrenceType === 'daily' && (
              <div className="space-y-2">
                <Label>תזמון יומי</Label>
                {DAY_NAMES.map((dayName, dayIndex) => (
                  <div key={dayIndex} className="flex items-center gap-2">
                    <span className="text-sm w-16 shrink-0">{dayName}</span>
                    <Select
                      value={dailySchedule[dayIndex] ?? 'none'}
                      onValueChange={v =>
                        setDailySchedule(prev => ({ ...prev, [dayIndex]: v }))
                      }
                    >
                      <SelectTrigger aria-label={`שיוך ל${dayName}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">ללא</SelectItem>
                        {members.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}

            {(recurrenceType === 'weekly' || recurrenceType === 'monthly') && (
              <div className="space-y-2">
                <Label>משוייך ל</Label>
                {members.map(m => (
                  <div key={m.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`assignee-${m.id}`}
                      checked={weeklyAssignees.includes(m.id)}
                      onChange={e => {
                        if (e.target.checked) {
                          setWeeklyAssignees(prev => [...prev, m.id])
                        } else {
                          setWeeklyAssignees(prev => prev.filter(uid => uid !== m.id))
                        }
                      }}
                      className="h-4 w-4 rounded border-input"
                    />
                    <Label htmlFor={`assignee-${m.id}`}>{m.name}</Label>
                  </div>
                ))}
              </div>
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'שומר...' : 'שמור'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Update `ChoreFormPage.test.tsx` — fix fixture and add schedule mock**

In `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx`:

**2a.** Update the `existingChore` fixture (line ~50): change `is_recurring: false` to `recurrence_type: 'none'`.

**2b.** In any test that calls `renderEdit()`, the component now makes TWO `supabase.from()` calls: one for the chore, one for `chore_schedule`. Update those tests to mock both calls using `mockReturnValueOnce`:

Find the test that mocks `mockFrom` for edit mode (likely the "loads existing chore data" test) and update it:

```typescript
it('loads existing chore data in edit mode', async () => {
  // First call: from('chores').select().eq().single()
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: existingChore, error: null }),
  })
  // Second call: from('chore_schedule').select().eq()
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: [], error: null }),
  })

  renderEdit()
  await waitFor(() => expect(screen.getByLabelText('שם המשימה')).toHaveValue('כלי מטבח'))
})
```

**2c.** Add a test for the recurrence selector:

```typescript
it('shows daily schedule grid when daily recurrence is selected', async () => {
  renderCreate()
  const recurrenceSelect = screen.getByRole('combobox', { name: 'סוג חזרה' })
  await userEvent.click(recurrenceSelect)
  await userEvent.click(screen.getByText('יומי'))
  expect(screen.getByText('ראשון')).toBeInTheDocument()
  expect(screen.getByText('שבת')).toBeInTheDocument()
})

it('shows member checkboxes when weekly recurrence is selected', async () => {
  renderCreate()
  const recurrenceSelect = screen.getByRole('combobox', { name: 'סוג חזרה' })
  await userEvent.click(recurrenceSelect)
  await userEvent.click(screen.getByText('שבועי'))
  expect(screen.getByLabelText('דנה')).toBeInTheDocument()
})
```

- [ ] **Step 3: Run the full test suite**

```bash
cd D:/Claude_Projects/family-chores
npx vitest run
```

Expected: all tests pass. If any test fails because `mockFrom` is called more times than expected, add a `mockReturnValue` fallback for the schedule query:

```typescript
// Default: schedule returns empty
mockFrom.mockReturnValue({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockResolvedValue({ data: [], error: null }),
  delete: vi.fn().mockReturnThis(),
  insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  update: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
})
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/chores/ChoreFormPage.tsx \
  src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx
git commit -m "feat: add recurrence type selector and schedule UI to ChoreFormPage"
```
