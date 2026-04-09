# Recurring Chores — Design Spec

**Date:** 2026-04-09
**Status:** Approved for implementation planning

---

## Goal

Support daily, weekly, and monthly chore recurrence. Daily chores auto-generate one assignment per player per day each week based on an admin-defined schedule. Weekly chores auto-generate one assignment per assigned player per week. Monthly is a label only — no auto-generation. Recurring chores never disappear from the pool; multiple players can independently hold assignments for the same chore.

---

## Example

"Feed the pet" is a daily chore with this schedule:
- Sunday, Tuesday → Dana
- Monday, Wednesday → Yossi
- Thursday, Friday, Saturday → Zoe

At the start of each week, `populate_weekly_assignments` creates 7 assignments: Dana×2, Yossi×2, Zoe×3. Any player can also self-assign on top of those. The chore stays visible in the pool all week.

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

Recurrence semantics:
- `none` — one-time chore, no auto-creation
- `weekly` — 1 assignment per assigned player per week (skipped if `assigned_to IS NULL` — stays as open pool)
- `daily` — 1 assignment per scheduled day per player (from `chore_daily_schedule`)
- `monthly` — label only, no auto-creation

### 2. New `chore_daily_schedule` table

```sql
CREATE TABLE chore_daily_schedule (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chore_id     UUID NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 6=Sat
  assigned_to  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (chore_id, day_of_week)
);
ALTER TABLE chore_daily_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chore_daily_schedule: family members can read"
  ON chore_daily_schedule FOR SELECT
  USING (chore_id IN (SELECT id FROM chores WHERE family_id = get_my_family_id()));
CREATE POLICY "chore_daily_schedule: admins can write"
  ON chore_daily_schedule FOR ALL
  USING (chore_id IN (SELECT id FROM chores WHERE family_id = get_my_family_id()) AND is_admin());
```

### 3. `chore_assignments` — new unique constraint

Prevents a player from having the same chore/day twice, while allowing multiple players to hold assignments for the same chore on the same day:

```sql
ALTER TABLE chore_assignments
  ADD CONSTRAINT chore_assignments_unique_player_slot
  UNIQUE NULLS NOT DISTINCT (chore_id, user_id, week_start, calendar_day);
```

---

## RPC: `populate_weekly_assignments`

Called client-side on dashboard load. Idempotent (safe to call multiple times).

```sql
CREATE OR REPLACE FUNCTION populate_weekly_assignments(p_week_start date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_family_id uuid;
  v_chore     RECORD;
  v_sched     RECORD;
BEGIN
  v_family_id := get_my_family_id();
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'no_family'; END IF;

  -- Weekly: one assignment per chore (only if assigned_to is set)
  FOR v_chore IN
    SELECT id, assigned_to FROM chores
    WHERE family_id = v_family_id
      AND recurrence_type = 'weekly'
      AND status = 'active'
      AND assigned_to IS NOT NULL
  LOOP
    INSERT INTO chore_assignments (chore_id, user_id, week_start)
    VALUES (v_chore.id, v_chore.assigned_to, p_week_start)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Daily: one assignment per scheduled day
  FOR v_chore IN
    SELECT id FROM chores
    WHERE family_id = v_family_id
      AND recurrence_type = 'daily'
      AND status = 'active'
  LOOP
    FOR v_sched IN
      SELECT day_of_week, assigned_to FROM chore_daily_schedule
      WHERE chore_id = v_chore.id AND assigned_to IS NOT NULL
    LOOP
      INSERT INTO chore_assignments (chore_id, user_id, week_start, calendar_day)
      VALUES (v_chore.id, v_sched.assigned_to, p_week_start, v_sched.day_of_week)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;
```

---

## Client Hook: `useWeeklyPopulation`

New hook at `src/hooks/useWeeklyPopulation.ts`. Called from `PlayerDashboard` and `AdminDashboard` on mount.

```typescript
// Pseudocode
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

Silent — no loading state, no UI feedback. Runs once per week per device.

---

## UI: ChoreFormPage

Replace the `is_recurring` checkbox with a recurrence type selector:

**All chore types — show selector:**
```
חזרה: [ ללא ▾ ]   (options: ללא / יומי / שבועי / חודשי)
```

**When `daily` is selected — show 7-day schedule:**
```
תזמון יומי:
ראשון:   [ דנה   ▾ ]
שני:     [ יוסי  ▾ ]
שלישי:   [ דנה   ▾ ]
רביעי:   [ יוסי  ▾ ]
חמישי:   [ זו    ▾ ]
שישי:    [ זו    ▾ ]
שבת:     [ זו    ▾ ]
```

Each day dropdown: options are family members + "ללא" (unassigned — no assignment created for that day).

**On save:**
- Insert/update `chore_daily_schedule` rows (upsert by `chore_id, day_of_week`)
- Delete `chore_daily_schedule` rows for days now set to "ללא"
- Wrap in a single transaction via RPC (see implementation plan)

**When `weekly`:** no schedule grid (assignee from existing "שייך ל" field).
**When `monthly` or `none`:** no schedule grid.

---

## Pool Behavior

The pool (`ChorePoolPage`) currently filters active chores. Recurring chores (`recurrence_type != 'none'`) must **never** be filtered out after assignment — they always remain visible. No schema change needed: chores stay `status='active'`; the pool only hides `archived` chores, which recurring chores never become automatically.

When a player picks up a `daily` recurring chore from the pool, they select which day of the current week. This adds a day-picker step to the pick-up flow for daily chores. For `weekly` and `monthly` chores, pick-up works as today (one assignment, no day selection).

---

## TypeScript Types

**`src/types/database.ts`:**
- `Chore`: replace `is_recurring: boolean` with `recurrence_type: 'none' | 'weekly' | 'daily' | 'monthly'`
- Add `RecurrenceType = 'none' | 'weekly' | 'daily' | 'monthly'`
- Add `ChoreDailySchedule` interface:
```typescript
export interface ChoreDailySchedule {
  id: string
  chore_id: string
  day_of_week: number  // 0=Sun, 6=Sat
  assigned_to: string | null
}
```

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/014_recurring_chores.sql` | New migration: recurrence_type column, chore_daily_schedule table, unique constraint, RPC |
| `src/types/database.ts` | Replace `is_recurring`, add `RecurrenceType`, add `ChoreDailySchedule` |
| `src/hooks/useWeeklyPopulation.ts` | New hook: idempotent weekly population trigger |
| `src/hooks/__tests__/useWeeklyPopulation.test.ts` | Tests for the hook |
| `src/pages/admin/chores/ChoreFormPage.tsx` | Replace checkbox with recurrence selector + daily schedule grid |
| `src/pages/player/PlayerDashboard.tsx` | Add `useWeeklyPopulation()` call |
| `src/pages/admin/AdminDashboard.tsx` | Add `useWeeklyPopulation()` call |

---

## Out of Scope

- Changing the day-picker UI when a player self-assigns a daily chore from the pool (future iteration — for now pool pick-up for daily chores creates a weekly assignment without a specific day)
- Notifications when recurring assignments are created
- Admin view of who is scheduled for which day this week (visible via the calendar)
