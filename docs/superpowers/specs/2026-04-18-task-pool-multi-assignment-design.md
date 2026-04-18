# Task Pool — Multi-Assignment & Checkmark Design Spec

**Date:** 2026-04-18
**Status:** Approved for implementation planning
**Builds on:** `2026-04-09-recurring-chores-design.md`

---

## Overview

This spec covers the behavioural and UI changes needed to support:
- Recurring tasks staying permanently in the pool regardless of how many players hold assignments
- Admin pre-assigning recurring tasks to **multiple players simultaneously**
- Players self-assigning via a **checkmark** (not a "pick up" button) that opens a slot-picker before confirming
- Multiple assignments occupying the same calendar slot, with stacked card UI
- Non-recurring tasks leaving the pool once claimed (tracked via `is_pool_visible`)
- Each player independently earning coins per completion of the same recurring task

All changes are deltas on top of `2026-04-09-recurring-chores-design.md`. Do not re-implement anything already covered there.

---

## 1. Data Model Changes

### 1.1 `chores` table — add `is_pool_visible`

```sql
ALTER TABLE chores
  ADD COLUMN is_pool_visible BOOLEAN NOT NULL DEFAULT TRUE;
```

**Semantics:**
- Recurring tasks (`recurrence_type != 'none'`): always `TRUE`. The Edge Function that creates recurring tasks explicitly sets `is_pool_visible = TRUE` rather than relying on the column default, ensuring consistency if the default ever changes.
- Non-recurring tasks (`recurrence_type = 'none'`): starts `TRUE`. Set to `FALSE` when a player self-assigns or admin assigns via the Edit Chore form. Reset to `TRUE` if the assignment is deleted or fails.

`chores.assigned_to` is kept for non-recurring chores only (existing behaviour). For recurring chores it must remain `NULL`.

### 1.2 `chore_assignments` — two changes

**Add `assigned_by` column:**

```sql
ALTER TABLE chore_assignments
  ADD COLUMN assigned_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE;
```

Tracks who created the assignment (admin or the player themselves). Read-only after insert.

**Replace unique constraint to allow same-day multi-slot:**

```sql
-- Drop the constraint added in 014_recurring_chores.sql
ALTER TABLE chore_assignments
  DROP CONSTRAINT chore_assignments_unique_player_slot;

-- New constraint: same player, same chore, same week, same day, same slot = conflict
ALTER TABLE chore_assignments
  ADD CONSTRAINT chore_assignments_unique_player_slot
  UNIQUE NULLS NOT DISTINCT (chore_id, user_id, week_start, calendar_day, calendar_slot);
```

This allows a player to hold the same recurring chore twice on the same day, as long as the slots differ. Two unslotted (NULL) assignments for the same chore/user/day still conflict.

### 1.3 `chore_schedule` — daily becomes multi-player per day

No schema change. The existing `UNIQUE NULLS NOT DISTINCT (chore_id, assigned_to, day_of_week)` already allows multiple players per day (different `assigned_to` values). Only the **admin UI** changes (see Section 3).

### 1.4 Migration file

`supabase/migrations/015_task_pool_multi_assign.sql`

---

## 2. Pool Visibility Logic

**Pool query — chores shown to players:**
```sql
SELECT * FROM chores
WHERE family_id = get_my_family_id()
  AND status = 'active'
  AND is_pool_visible = TRUE;
```

**When a non-recurring chore is claimed** (self-assign or admin-assign):
- Edge Function sets `chores.is_pool_visible = FALSE` atomically with the `chore_assignments` insert.

**When a non-recurring assignment is deleted or transitions to `failed`:**
- Edge Function resets `chores.is_pool_visible = TRUE`, returning it to the pool.

Recurring chores: `is_pool_visible` is never touched by the system. Pool always shows them.

---

## 3. Admin UI Changes

### 3.1 Daily schedule grid — multi-player per day

Replace the single-player dropdown per day with a **multi-select checkbox list** per day:

```
תזמון יומי:
ראשון:   ☑ דנה  ☑ יוסי  ☐ זו
שני:     ☐ דנה  ☑ יוסי  ☐ זו
שלישי:   ☑ דנה  ☐ יוסי  ☑ זו
...
```

Each checked player on a given day = one `chore_schedule` row with that `day_of_week`.

On save: delete all existing `chore_schedule` rows for the chore, insert fresh rows from the form (same approach as the 2026-04-09 design, unchanged).

### 3.2 Recurring task detail panel (admin dashboard)

Each recurring task card in the admin dashboard shows:
- Recurrence badge: `🔁 יומי` / `🔁 שבועי` / `🔁 חודשי`
- Count of players with an active assignment this period: `3 שחקנים פעילים`

Clicking the card opens a detail panel listing all current `chore_assignments` rows for this chore in the current week, grouped by player, with status badges.

---

## 4. Player UI Changes

### 4.1 Pool task card — checkmark self-assign

Replace the "בחר משימה" (pick up) button on each pool card with a **checkmark button (☐)**.

**Tap flow:**
1. Player taps ☐ on a pool task card
2. A **slot-picker bottom sheet** opens:
   - Day selector: Sun–Sat (defaults to today)
   - Time slot selector: 🌅 בוקר / ☀️ צהריים / 🌆 אחה"צ + "ללא שיוך" (no slot)
   - Confirm button: `שייך אליי`
3. On confirm: calls `self-assign-chore` Edge Function with `chore_id`, `calendar_day`, `calendar_slot`
4. On success: checkmark turns filled (☑), card stays in pool (recurring) or disappears (non-recurring)

**Pool card avatar stack:**
Recurring task cards show a compact avatar row of players who already have an active assignment this period, up to 3 avatars + overflow count (e.g. `+2`).

### 4.2 Player dashboard

Assignments from admin pre-assignment and self-assignment appear identically — `assigned_by` is not shown to players. If a player holds the same recurring chore in two different slots, two separate cards appear, each with its own slot label and independent completion state.

---

## 5. Calendar — Stacked Slot UI

### 5.1 Data

A slot cell (day × time-slot) may now contain multiple `chore_assignments`. The calendar query fetches all non-archived assignments for the current week, grouped by `(calendar_day, calendar_slot)`.

### 5.2 Layout

Each cell is a **vertical scroll container** with `overflow-y: auto` and `max-height`:
- Mobile: `max-height: 160px`
- Desktop: no max-height (cell expands vertically)

Each assignment within a cell renders as a **compact card**:
```
[ avatar ] Chore title            ● status dot
```
Height: ~40px. Cards are stacked vertically with 4px gap.

**Overflow collapse (mobile):** If more than 3 cards would appear in a cell, show 2 cards + a footer:
```
ועוד 2 משימות ▾
```
Tapping the footer expands all cards inline.

### 5.3 Interaction

Tapping any card in a slot opens the full assignment detail sheet (same as existing behaviour).

---

## 6. Edge Functions

### 6.1 `self-assign-chore`

**Input:**
```typescript
{ chore_id: string, calendar_day: number | null, calendar_slot: string | null }
```

**Input validation (before any DB access):**
- `chore_id`: must be a valid UUID string — reject with `INVALID_INPUT` if not
- `calendar_day`: must be `null` or an integer in `[0, 6]` — reject with `INVALID_CALENDAR_DAY` otherwise
- `calendar_slot`: must be `null` or one of `'morning' | 'noon' | 'afternoon'` — reject with `INVALID_CALENDAR_SLOT` otherwise

**Server-side validation (service_role):**
1. Verify calling user's `family_id` matches the chore's `family_id` — rejects cross-family requests
2. Verify chore `status = 'active'` and `is_pool_visible = TRUE`
3. For `recurrence_type = 'none'`: verify no active assignment already exists (exclusivity guard)
4. Check no existing assignment for same `(chore_id, user_id, week_start, calendar_day, calendar_slot)` — prevents duplicate
5. Insert `chore_assignments` row with `assigned_by = caller_uid`
6. For `recurrence_type = 'none'`: set `chores.is_pool_visible = FALSE`
7. Insert `chore_assigned` notification for the player
8. Log the assignment event (see Section 8.2)

All steps run in a single Postgres transaction via `service_role`. On any validation failure, return a structured error code (not a raw Postgres error) so the client can show a Hebrew message.

**Rate limit:** 20 calls/minute per user — enforced via Upstash Redis (`@upstash/ratelimit` library) within the Edge Function. The Redis instance is provisioned via the Supabase Marketplace integration. If Redis is unavailable, the function fails open (allows the request) and logs a warning — rate limiting is a protection layer, not a hard dependency for correctness.

When failing open, the Edge Function emits a structured warning log:
```json
{ "event": "rate_limit_unavailable", "function": "self-assign-chore", "user_id": "...", "ts": "..." }
```
These warnings are monitored via a Supabase Log Drain alert rule: if more than 5 `rate_limit_unavailable` events occur within a 10-minute window, an alert is sent to the admin's email. This enables prompt investigation of Redis outages and any abuse that may occur during the unprotected window.

### 6.2 `admin-assign-chore`

Called only for **pool-side admin assignment** (admin taps assign on a pool card). Admin assignment via the Edit Chore form (non-recurring `assigned_to` field) continues to use a direct Supabase client call to update `chores.assigned_to`, which is already covered by existing admin RLS policies.

**Input:**
```typescript
{ chore_id: string, user_ids: string[] }
```

**Input validation (before any DB access):**
- `chore_id`: must be a valid UUID string — reject with `INVALID_INPUT` if not
- `user_ids`: must be a non-empty array of valid UUID strings — reject with `INVALID_INPUT` otherwise
- For `recurrence_type = 'none'`: `user_ids` must have **exactly 1 entry** — reject with `TOO_MANY_ASSIGNEES` if more than 1 is provided

**Server-side validation:**
1. Verify caller is `admin` and shares `family_id` with the chore
2. Verify chore `status = 'active'`
3. Verify all `user_ids` belong to the same family as the chore
4. For `recurrence_type = 'none'`: set `is_pool_visible = FALSE`
5. Insert one `chore_assignments` row per `user_id` with `assigned_by = admin_uid` (`ON CONFLICT DO NOTHING`)
6. Insert `chore_assigned` notification per player
7. Log the assignment event (see Section 8.2)

**Rate limit:** 30 calls/minute per admin — same Upstash Redis mechanism as `self-assign-chore`.

---

## 7. RLS Changes

### 7.1 `chore_assignments` — remove player INSERT policy

The INSERT policy for players added in `002_rls.sql` is dropped. All inserts now go through Edge Functions:

```sql
DROP POLICY IF EXISTS "assignments: players can insert for themselves; admins can insert for anyone"
  ON chore_assignments;
```

Players retain:
- **SELECT**: own assignments (unchanged)
- **UPDATE**: `calendar_day`, `calendar_slot`, `reminder_enabled` only

The UPDATE policy is replaced with an explicit column-level restriction using a trigger rather than relying solely on `WITH CHECK`. A `BEFORE UPDATE` trigger on `chore_assignments` raises an exception if a player attempts to change any column other than `calendar_day`, `calendar_slot`, or `reminder_enabled`:

```sql
CREATE OR REPLACE FUNCTION enforce_player_assignment_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN
    IF (OLD.chore_id      IS DISTINCT FROM NEW.chore_id)      OR
       (OLD.user_id       IS DISTINCT FROM NEW.user_id)       OR
       (OLD.week_start    IS DISTINCT FROM NEW.week_start)    OR
       (OLD.status        IS DISTINCT FROM NEW.status)        OR
       (OLD.assigned_by   IS DISTINCT FROM NEW.assigned_by)   OR
       (OLD.archived      IS DISTINCT FROM NEW.archived)
    THEN
      RAISE EXCEPTION 'FORBIDDEN_FIELD_UPDATE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chore_assignments_player_update_guard
  BEFORE UPDATE ON chore_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_player_assignment_update();
```

This defence-in-depth approach means even if an RLS `WITH CHECK` misconfiguration occurs, players cannot overwrite protected fields.

### 7.2 `chores` — remove player UPDATE access to `is_pool_visible`

The existing player UPDATE policy does not cover chores (only admins can update chores). `is_pool_visible` is written only by Edge Functions via `service_role`. No new policy needed.

---

## 8. Security & Observability

### 8.1 Security principles
- All SQL within Edge Functions uses parameterised queries (Supabase JS client `.eq()` / `.insert()` calls) — no string interpolation
- `family_id` ownership is verified server-side on every Edge Function call before any read or write
- `assigned_by` is set server-side from `auth.uid()` — clients cannot spoof it
- Structured error codes returned to clients: `CHORE_NOT_FOUND`, `ALREADY_ASSIGNED`, `NOT_IN_FAMILY`, `CHORE_TAKEN`, `INVALID_INPUT`, `INVALID_CALENDAR_DAY`, `INVALID_CALENDAR_SLOT`, `TOO_MANY_ASSIGNEES`, `FORBIDDEN_FIELD_UPDATE` — no raw Postgres error messages exposed
- Raw Postgres errors are caught in a top-level `try/catch` in each Edge Function and logged server-side; the client receives only the generic `INTERNAL_ERROR` code

### 8.2 Client-side error handling
The client maintains a map of error codes to Hebrew messages:
```typescript
const ASSIGNMENT_ERRORS: Record<string, string> = {
  CHORE_NOT_FOUND:        'המשימה לא נמצאה',
  ALREADY_ASSIGNED:       'כבר שויכת למשימה זו בחריץ זה',
  NOT_IN_FAMILY:          'אין הרשאה לגשת למשימה זו',
  CHORE_TAKEN:            'המשימה כבר נלקחה על ידי שחקן אחר',
  INVALID_INPUT:          'קלט לא תקין — אנא נסה שנית',
  INVALID_CALENDAR_DAY:   'יום לא תקין',
  INVALID_CALENDAR_SLOT:  'חריץ זמן לא תקין',
  TOO_MANY_ASSIGNEES:     'ניתן לשייך רק שחקן אחד למשימה שאינה חוזרת',
  FORBIDDEN_FIELD_UPDATE: 'פעולה זו אינה מורשית',
  INTERNAL_ERROR:         'שגיאה פנימית — אנא נסה שנית מאוחר יותר',
}
```
The slot-picker sheet and pool card both display the localised message as a toast notification on failure.

### 8.3 Edge Function logging
Both `self-assign-chore` and `admin-assign-chore` emit structured log entries using `console.log` (captured by Supabase Edge Function logs):

**On success:**
```json
{ "event": "chore_assigned", "chore_id": "...", "user_id": "...", "assigned_by": "...", "recurrence_type": "daily", "calendar_day": 1, "calendar_slot": "morning", "ts": "2026-04-18T10:00:00Z" }
```

**On validation failure:**
```json
{ "event": "assign_rejected", "reason": "ALREADY_ASSIGNED", "chore_id": "...", "user_id": "...", "ts": "..." }
```

**On unexpected error:**
```json
{ "event": "assign_error", "message": "<sanitised error message, no PII>", "chore_id": "...", "user_id": "...", "ts": "..." }
```

No PII (email, name, photo URLs) is written to logs. `user_id` and `chore_id` are UUIDs — opaque identifiers suitable for audit without exposing personal data.

---

## 9. File Map

| File | Change |
|---|---|
| `supabase/migrations/015_task_pool_multi_assign.sql` | `is_pool_visible` column, `assigned_by` column, updated unique constraint, drop player INSERT policy, player UPDATE guard trigger |
| `supabase/functions/self-assign-chore/index.ts` | New Edge Function |
| `supabase/functions/admin-assign-chore/index.ts` | New Edge Function |
| `src/types/database.ts` | Add `is_pool_visible` to `Chore`; add `assigned_by` to `ChoreAssignment` |
| `src/pages/player/ChorePoolPage.tsx` | Replace pick-up button with checkmark + slot-picker sheet |
| `src/components/player/SlotPickerSheet.tsx` | New bottom-sheet component |
| `src/pages/admin/chores/ChoreFormPage.tsx` | Daily schedule grid: single dropdown → multi-checkbox per day |
| `src/pages/admin/AdminDashboard.tsx` | Recurring task detail panel |
| `src/pages/player/CalendarPage.tsx` | Stacked slot cells with overflow collapse |
| `src/components/calendar/SlotCell.tsx` | New component — vertical scroll container for stacked cards |

---

## 10. Out of Scope

- Push notifications when recurring assignments are auto-created
- Admin ability to delete a specific player's assignment from the detail panel (future)
- "Undo" self-assign (player can delete assignment from their dashboard — existing behaviour)
- Coin award logic changes (handled by existing completion approval flow — unchanged)
