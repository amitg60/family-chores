# Recurring Chores — Design Spec

**Date:** 2026-04-09
**Status:** Approved for implementation planning

---

## Goal

Support daily, weekly, and monthly chore recurrence with a unified schedule table. Daily chores auto-generate one assignment per player per scheduled day each week. Weekly chores auto-generate one assignment per scheduled player per week. Monthly is a label with documented assignees but no auto-generation. Recurring chores never disappear from the pool; multiple players can independently hold assignments for the same chore.

---

## Example

**Daily — "Feed the pet":**
Schedule: Sun=Dana, Mon=Yossi, Tue=Dana, Wed=Yossi, Thu=Zoe, Fri=Zoe, Sat=Zoe.
At week start: 7 assignments created (Dana×2, Yossi×2, Zoe×3). Extra players can still self-assign from pool.

**Weekly — "Vacuum the house":**
Schedule: Dana, Yossi (two rows, `day_of_week = NULL`).
At week start: 2 assignments created (one for Dana, one for Yossi). Others can still self-assign.

**Monthly — "Deep clean the bathroom":**
Schedule: Dana (one row, `day_of_week = NULL`).
No auto-creation. Admin creates assignment manually. Schedule is for documentation/display only.

---

## Data Model Changes

### 1. `chores` table — replace `is_recurring`

```sql
ALTER TABLE chores
  ADD COLUMN recurrence_type TEXT NOT NULL DEFAULT 'none'
    CHECK (recurrence_type IN ('none', 'weekly', 'daily', 'monthly'));

UPDATE chores SET recurrence_type = 'weekly' WHERE is_recurring = true;

ALTER TABLE chores DROP COLUMN is_recurring;
```

`chores.assigned_to` is kept for non-recurring chores only. For recurring chores, the `chore_schedule` table owns assignments.

### 2. New `chore_schedule` table

Unified schedule for all recurrence types. `day_of_week` is null for weekly/monthly (no specific day), 0–6 for daily.

```sql
CREATE TABLE chore_schedule (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chore_id     UUID NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  day_of_week  INTEGER CHECK (day_of_week BETWEEN 0 AND 6), -- NULL = weekly/monthly
  assigned_to  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (chore_id, assigned_to, day_of_week)
);

ALTER TABLE chore_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chore_schedule: family members can read"
  ON chore_schedule FOR SELECT
  USING (chore_id IN (SELECT id FROM chores WHERE family_id = get_my_family_id()));

CREATE POLICY "chore_schedule: admins can write"
  ON chore_schedule FOR ALL
  USING (chore_id IN (SELECT id FROM chores WHERE family_id = get_my_family_id()) AND is_admin());
```

### 3. `chore_assignments` — new unique constraint

Prevents a player from having the same chore/day twice, while allowing multiple players on the same chore:

```sql
ALTER TABLE chore_assignments
  ADD CONSTRAINT chore_assignments_unique_player_slot
  UNIQUE NULLS NOT DISTINCT (chore_id, user_id, week_start, calendar_day);
```

---

## RPC: `populate_weekly_assignments`

Called client-side on dashboard load. Idempotent (`ON CONFLICT DO NOTHING`).

```sql
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
    ON CONFLICT DO NOTHING;
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
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Monthly: no auto-creation (label only)
END;
$$;
```

---

## Client Hook: `useWeeklyPopulation`

New hook at `src/hooks/useWeeklyPopulation.ts`. Called silently from `PlayerDashboard` and `AdminDashboard`.

```typescript
const STORAGE_KEY = 'weeklyPopulated'

export function useWeeklyPopulation() {
  const { profile } = useAuth()
  useEffect(() => {
    if (!profile?.family_id) return
    const currentWeek = getCurrentWeekStart()
    if (localStorage.getItem(STORAGE_KEY) === currentWeek) return
    supabase.rpc('populate_weekly_assignments', { p_week_start: currentWeek })
      .then(() => localStorage.setItem(STORAGE_KEY, currentWeek))
      .catch(err => console.error('[useWeeklyPopulation]', err))
  }, [profile?.family_id])
}
```

No loading state, no UI feedback. Runs once per week per device.

---

## UI: ChoreFormPage

Replace the `is_recurring` checkbox with a recurrence type selector (shown for all chores):

```
חזרה: [ ללא ▾ ]   options: ללא / יומי / שבועי / חודשי
```

**When `daily` selected — 7-day schedule grid:**

```
תזמון יומי:
ראשון:   [ דנה  ▾ ]
שני:     [ יוסי ▾ ]
שלישי:   [ דנה  ▾ ]
רביעי:   [ יוסי ▾ ]
חמישי:   [ זו   ▾ ]
שישי:    [ זו   ▾ ]
שבת:     [ זו   ▾ ]
```

Each day: dropdown of family members + "ללא" (no assignment for that day → no row in `chore_schedule`).

**When `weekly` or `monthly` selected — multi-player picker:**

```
משוייך ל:
☑ דנה
☑ יוסי
☐ זו
```

Checkboxes for each family member. Checked = row in `chore_schedule` with `day_of_week = NULL`. For monthly this is documentation only (shown in UI, not auto-assigned).

**On save (create or edit):**
1. Save/update chore row with new `recurrence_type`
2. Delete all existing `chore_schedule` rows for this chore
3. Insert new `chore_schedule` rows from the form

Both steps go through direct Supabase client calls (delete + insert). No custom RPC needed — RLS handles authorization.

**When `none` selected:** no schedule UI shown. `chores.assigned_to` field (existing "שייך ל") is used as today.

---

## Pool Behavior

Recurring chores (`recurrence_type != 'none'`) always remain visible in the pool. No schema change needed — chores stay `status='active'` and are never auto-archived. The pool already shows all active chores.

When a player self-assigns from pool:
- Weekly/monthly chores: pick-up creates one assignment for the current week (no calendar_day), same as today
- Daily chores: pick-up creates one assignment for the current week without a specific day (calendar_day = null) — player can later pin it to a day via the calendar

---

## TypeScript Types

**`src/types/database.ts`:**

```typescript
export type RecurrenceType = 'none' | 'weekly' | 'daily' | 'monthly'

// In Chore interface: replace is_recurring: boolean with:
recurrence_type: RecurrenceType

// New interface:
export interface ChoreSchedule {
  id: string
  chore_id: string
  day_of_week: number | null  // null = weekly/monthly, 0–6 = daily
  assigned_to: string
}
```

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/014_recurring_chores.sql` | `recurrence_type` column, `chore_schedule` table + RLS, unique constraint on assignments, `populate_weekly_assignments` RPC |
| `src/types/database.ts` | Replace `is_recurring`, add `RecurrenceType`, add `ChoreSchedule` |
| `src/hooks/useWeeklyPopulation.ts` | New hook — idempotent weekly population trigger |
| `src/hooks/__tests__/useWeeklyPopulation.test.ts` | Tests for the hook |
| `src/pages/admin/chores/ChoreFormPage.tsx` | Replace checkbox with recurrence selector + schedule UI |
| `src/pages/player/PlayerDashboard.tsx` | Add `useWeeklyPopulation()` call |
| `src/pages/admin/AdminDashboard.tsx` | Add `useWeeklyPopulation()` call |

---

## Out of Scope

- Day-picker when a player self-assigns a daily chore from the pool (future — for now creates assignment without specific day)
- Notifications when recurring assignments are created
- Admin view showing the full weekly schedule (visible via calendar)
- Reassignment UI (future barter system)
