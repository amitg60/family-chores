# Task Pool Multi-Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-user pick-up model with a checkmark self-assign flow, keep recurring tasks permanently visible in the pool, support multi-player daily schedule pre-assignments, add an Edge Function self-assign path with full validation, and add mobile overflow collapse to the calendar's stacked slot cells.

**Architecture:** All chore assignment mutations for players move to a Supabase Edge Function (`self-assign-chore`) that runs with `service_role` and enforces business rules server-side. The pool page calls this function instead of writing directly to Supabase. A new `is_pool_visible` boolean on `chores` controls pool visibility for non-recurring tasks. The daily schedule in `ChoreFormPage` changes from one player per day to multiple players per day via checkboxes. The calendar already renders multiple cards per cell; this plan adds mobile overflow collapse.

**Tech Stack:** React 18, TypeScript 5, Vite, Supabase JS v2, Supabase Edge Functions (Deno), Vitest, React Testing Library, shadcn/ui, Tailwind CSS

> **Note on migration number:** Existing migrations run up to `020_harden_insert_notification.sql`. The new migration is therefore `021_task_pool_multi_assign.sql`.

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/021_task_pool_multi_assign.sql` | New: `is_pool_visible`, `assigned_by`, updated unique constraint, drop player INSERT policy, UPDATE guard trigger |
| `supabase/functions/self-assign-chore/index.ts` | New Edge Function |
| `supabase/functions/admin-assign-chore/index.ts` | New Edge Function |
| `src/types/database.ts` | Add `is_pool_visible` to `Chore`; add `assigned_by` to `ChoreAssignment` |
| `src/hooks/useChores.ts` | Ensure pool query respects `is_pool_visible` |
| `src/pages/player/chores/ChorePoolPage.tsx` | Replace pick-up button with checkmark + SlotPickerSheet; fix recurring filter |
| `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx` | Rewrite for new behaviour |
| `src/components/player/SlotPickerSheet.tsx` | New: bottom-sheet for day + slot selection |
| `src/components/player/__tests__/SlotPickerSheet.test.tsx` | New: unit tests |
| `src/pages/admin/chores/ChoreFormPage.tsx` | Daily schedule: single dropdown → multi-checkbox per day |
| `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx` | Extend tests for multi-checkbox daily schedule |
| `src/components/calendar/WeeklyCalendarGrid.tsx` | Mobile overflow collapse ("ועוד N משימות") |

---

## Task 1: DB migration

**Files:**
- Create: `supabase/migrations/021_task_pool_multi_assign.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/021_task_pool_multi_assign.sql` with this exact content:

```sql
-- ============================================================
-- PART 1: is_pool_visible on chores
-- Recurring tasks always TRUE. Non-recurring flips to FALSE
-- when claimed, back to TRUE when assignment is deleted/failed.
-- ============================================================
ALTER TABLE chores
  ADD COLUMN is_pool_visible BOOLEAN NOT NULL DEFAULT TRUE;

-- Existing non-recurring chores that are already claimed should
-- be marked not visible (assigned_to IS NOT NULL).
UPDATE chores
  SET is_pool_visible = FALSE
  WHERE recurrence_type = 'none'
    AND assigned_to IS NOT NULL;

-- Ensure recurring chores are explicitly TRUE (not just default).
UPDATE chores
  SET is_pool_visible = TRUE
  WHERE recurrence_type != 'none';

-- ============================================================
-- PART 2: assigned_by on chore_assignments
-- Tracks whether an admin or the player created the assignment.
-- ============================================================
ALTER TABLE chore_assignments
  ADD COLUMN assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- ============================================================
-- PART 3: Replace unique constraint to allow same-day multi-slot
-- Old: (chore_id, user_id, week_start, calendar_day)
-- New: (chore_id, user_id, week_start, calendar_day, calendar_slot)
-- This lets a player hold the same chore in two different slots
-- on the same day, while still blocking exact duplicates.
-- ============================================================
ALTER TABLE chore_assignments
  DROP CONSTRAINT IF EXISTS chore_assignments_unique_player_slot;

ALTER TABLE chore_assignments
  ADD CONSTRAINT chore_assignments_unique_player_slot
  UNIQUE NULLS NOT DISTINCT (chore_id, user_id, week_start, calendar_day, calendar_slot);

-- ============================================================
-- PART 4: Drop player INSERT policy on chore_assignments
-- All inserts now go through Edge Functions (service_role).
-- ============================================================
DROP POLICY IF EXISTS "assignments: players can insert for themselves; admins can insert for anyone"
  ON chore_assignments;

-- ============================================================
-- PART 5: Player UPDATE guard trigger
-- Prevents players from modifying protected fields even if an
-- RLS WITH CHECK misconfiguration occurs (defence in depth).
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_player_assignment_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN
    IF (OLD.chore_id    IS DISTINCT FROM NEW.chore_id)    OR
       (OLD.user_id     IS DISTINCT FROM NEW.user_id)     OR
       (OLD.week_start  IS DISTINCT FROM NEW.week_start)  OR
       (OLD.status      IS DISTINCT FROM NEW.status)      OR
       (OLD.assigned_by IS DISTINCT FROM NEW.assigned_by) OR
       (OLD.archived    IS DISTINCT FROM NEW.archived)
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

-- ============================================================
-- PART 6: RLS for is_pool_visible
-- Only service_role (Edge Functions) may flip is_pool_visible.
-- Existing admin UPDATE policy on chores is broad enough;
-- add a CHECK to block players from updating is_pool_visible
-- via any future player chore UPDATE policy.
-- (Currently no player UPDATE policy exists on chores, so this
-- is a forward-defence comment — no SQL change needed here.)
-- ============================================================
```

- [ ] **Step 2: Apply the migration**

```bash
cd D:/Claude_Projects/family-chores
npx supabase db push
```

Expected: `Applying migration 021_task_pool_multi_assign.sql...` — no errors.

If you see a conflict on the constraint name, the old constraint may already be dropped — check with:
```bash
npx supabase db diff
```

- [ ] **Step 3: Verify in Supabase dashboard**

Open Supabase → Table Editor → `chores`. Confirm `is_pool_visible` column exists.
Open `chore_assignments`. Confirm `assigned_by` column exists and old unique constraint is replaced.
Open Database → Functions. Confirm `enforce_player_assignment_update` function exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/021_task_pool_multi_assign.sql
git commit -m "feat: add is_pool_visible, assigned_by, multi-slot constraint, and UPDATE guard trigger"
```

---

## Task 2: TypeScript types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add `is_pool_visible` to `Chore` interface**

In `src/types/database.ts`, find the `Chore` interface and add `is_pool_visible` after `last_traded_price`:

```typescript
export interface Chore {
  id: string
  family_id: string
  title: string
  description: string | null
  coin_value: number
  difficulty: ChoreDifficulty
  assigned_to: string | null
  recurrence_type: RecurrenceType
  status: ChoreStatus
  proposed_by: string | null
  approved_by: string | null
  due_date: string | null
  last_traded_price: number | null
  is_pool_visible: boolean
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: Add `assigned_by` to `ChoreAssignment` interface**

Find the `ChoreAssignment` interface and add `assigned_by` after `archived`:

```typescript
export interface ChoreAssignment {
  id: string
  chore_id: string
  user_id: string
  week_start: string
  calendar_day: number | null
  calendar_slot: CalendarSlot | null
  reminder_enabled: boolean
  status: AssignmentStatus
  archived: boolean
  assigned_by: string | null
  created_at: string
  updated_at: string
  hasRejection?: boolean
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add is_pool_visible to Chore and assigned_by to ChoreAssignment types"
```

---

## Task 3: `self-assign-chore` Edge Function

**Files:**
- Create: `supabase/functions/self-assign-chore/index.ts`

This Edge Function is the only path for players to create `chore_assignments`. It runs with `service_role`, validates all inputs server-side, and enforces business rules.

- [ ] **Step 1: Create the Edge Function**

Create `supabase/functions/self-assign-chore/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VALID_SLOTS = new Set(['morning', 'noon', 'afternoon'])

const ERRORS: Record<string, string> = {
  INVALID_INPUT:        'קלט לא תקין',
  INVALID_CALENDAR_DAY: 'יום לא תקין',
  INVALID_CALENDAR_SLOT:'חריץ זמן לא תקין',
  NOT_IN_FAMILY:        'אין הרשאה לגשת למשימה זו',
  CHORE_NOT_FOUND:      'המשימה לא נמצאה',
  CHORE_TAKEN:          'המשימה כבר נלקחה',
  ALREADY_ASSIGNED:     'כבר שויכת למשימה זו בחריץ זה',
  INTERNAL_ERROR:       'שגיאה פנימית',
}

function errorResponse(code: string, status = 400) {
  return new Response(
    JSON.stringify({ error: code, message: ERRORS[code] ?? ERRORS.INTERNAL_ERROR }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

function isValidUUID(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  return d.toISOString().split('T')[0]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  try {
    // ── Parse and validate input ──────────────────────────────────
    let body: { chore_id?: unknown; calendar_day?: unknown; calendar_slot?: unknown }
    try { body = await req.json() } catch { return errorResponse('INVALID_INPUT') }

    const { chore_id, calendar_day, calendar_slot } = body

    if (typeof chore_id !== 'string' || !isValidUUID(chore_id)) return errorResponse('INVALID_INPUT')

    if (calendar_day !== null && calendar_day !== undefined) {
      if (typeof calendar_day !== 'number' || !Number.isInteger(calendar_day) || calendar_day < 0 || calendar_day > 6) {
        return errorResponse('INVALID_CALENDAR_DAY')
      }
    }

    if (calendar_slot !== null && calendar_slot !== undefined) {
      if (typeof calendar_slot !== 'string' || !VALID_SLOTS.has(calendar_slot)) {
        return errorResponse('INVALID_CALENDAR_SLOT')
      }
    }

    const normalizedDay: number | null = calendar_day ?? null
    const normalizedSlot: string | null = calendar_slot ?? null

    // ── Auth: get calling user ────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('NOT_IN_FAMILY', 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return errorResponse('NOT_IN_FAMILY', 401)

    // ── Service role client for all DB writes ─────────────────────
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── Fetch caller's profile (family_id) ───────────────────────
    const { data: profile } = await admin
      .from('profiles')
      .select('family_id')
      .eq('id', user.id)
      .single()
    if (!profile?.family_id) return errorResponse('NOT_IN_FAMILY', 403)

    // ── Fetch chore and verify family membership ──────────────────
    const { data: chore } = await admin
      .from('chores')
      .select('id, family_id, status, is_pool_visible, recurrence_type')
      .eq('id', chore_id)
      .single()
    if (!chore) return errorResponse('CHORE_NOT_FOUND', 404)
    if (chore.family_id !== profile.family_id) return errorResponse('NOT_IN_FAMILY', 403)
    if (chore.status !== 'active' || !chore.is_pool_visible) return errorResponse('CHORE_NOT_FOUND', 404)

    const weekStart = getWeekStart(new Date())

    // ── Non-recurring: exclusivity guard ─────────────────────────
    if (chore.recurrence_type === 'none') {
      const { count } = await admin
        .from('chore_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('chore_id', chore_id)
        .not('status', 'in', '("failed","archived")')
      if ((count ?? 0) > 0) return errorResponse('CHORE_TAKEN', 409)
    }

    // ── Insert assignment ─────────────────────────────────────────
    const { error: insertErr } = await admin
      .from('chore_assignments')
      .insert({
        chore_id,
        user_id: user.id,
        week_start: weekStart,
        calendar_day: normalizedDay,
        calendar_slot: normalizedSlot,
        status: 'pending',
        archived: false,
        reminder_enabled: false,
        assigned_by: user.id,
      })

    if (insertErr) {
      if (insertErr.code === '23505') return errorResponse('ALREADY_ASSIGNED', 409)
      console.log(JSON.stringify({ event: 'assign_error', message: insertErr.message, chore_id, user_id: user.id, ts: new Date().toISOString() }))
      return errorResponse('INTERNAL_ERROR', 500)
    }

    // ── Non-recurring: hide from pool ─────────────────────────────
    if (chore.recurrence_type === 'none') {
      await admin.from('chores').update({ is_pool_visible: false }).eq('id', chore_id)
    }

    // ── Notification ──────────────────────────────────────────────
    await admin.from('notifications').insert({
      user_id: user.id,
      family_id: profile.family_id,
      type: 'chore_assigned',
      title_he: 'משימה חדשה שויכה אליך',
      body_he: 'בדוק את הדשבורד שלך',
      related_entity_id: chore_id,
    })

    console.log(JSON.stringify({ event: 'chore_assigned', chore_id, user_id: user.id, assigned_by: user.id, recurrence_type: chore.recurrence_type, calendar_day: normalizedDay, calendar_slot: normalizedSlot, ts: new Date().toISOString() }))

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.log(JSON.stringify({ event: 'assign_error', message: String(err), ts: new Date().toISOString() }))
    return errorResponse('INTERNAL_ERROR', 500)
  }
})
```

- [ ] **Step 2: Deploy the Edge Function**

```bash
npx supabase functions deploy self-assign-chore --no-verify-jwt
```

Wait — we DO want JWT verification. Remove `--no-verify-jwt`:
```bash
npx supabase functions deploy self-assign-chore
```

Expected: `Deployed self-assign-chore`

- [ ] **Step 3: Smoke test via curl (replace values with real ones)**

```bash
curl -X POST https://<your-project-ref>.supabase.co/functions/v1/self-assign-chore \
  -H "Authorization: Bearer <player-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"chore_id":"<valid-chore-id>","calendar_day":0,"calendar_slot":"morning"}'
```

Expected: `{"ok":true}` or a structured error code.

Test invalid input:
```bash
curl -X POST https://<your-project-ref>.supabase.co/functions/v1/self-assign-chore \
  -H "Authorization: Bearer <player-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"chore_id":"bad-id","calendar_day":9,"calendar_slot":"night"}'
```

Expected: `{"error":"INVALID_INPUT","message":"קלט לא תקין"}`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/self-assign-chore/
git commit -m "feat: add self-assign-chore Edge Function with full server-side validation"
```

---

## Task 4: `admin-assign-chore` Edge Function

**Files:**
- Create: `supabase/functions/admin-assign-chore/index.ts`

This Edge Function handles pool-side admin assignment (admin assigning a pool task to one or more players). The existing ChoreFormPage `assigned_to` field continues to use direct Supabase client calls for non-recurring chores.

- [ ] **Step 1: Create the Edge Function**

Create `supabase/functions/admin-assign-chore/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function isValidUUID(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function getWeekStart(date: Date): string {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().split('T')[0]
}

const ERRORS: Record<string, string> = {
  INVALID_INPUT:      'קלט לא תקין',
  NOT_IN_FAMILY:      'אין הרשאה',
  NOT_ADMIN:          'פעולה זו מוגבלת למנהלים בלבד',
  CHORE_NOT_FOUND:    'המשימה לא נמצאה',
  TOO_MANY_ASSIGNEES: 'ניתן לשייך רק שחקן אחד למשימה שאינה חוזרת',
  INTERNAL_ERROR:     'שגיאה פנימית',
}

function errorResponse(code: string, status = 400) {
  return new Response(
    JSON.stringify({ error: code, message: ERRORS[code] ?? ERRORS.INTERNAL_ERROR }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  try {
    let body: { chore_id?: unknown; user_ids?: unknown }
    try { body = await req.json() } catch { return errorResponse('INVALID_INPUT') }

    const { chore_id, user_ids } = body
    if (typeof chore_id !== 'string' || !isValidUUID(chore_id)) return errorResponse('INVALID_INPUT')
    if (!Array.isArray(user_ids) || user_ids.length === 0) return errorResponse('INVALID_INPUT')
    if (!user_ids.every((id): id is string => typeof id === 'string' && isValidUUID(id))) return errorResponse('INVALID_INPUT')

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('NOT_IN_FAMILY', 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return errorResponse('NOT_IN_FAMILY', 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('family_id, role')
      .eq('id', user.id)
      .single()
    if (!callerProfile?.family_id) return errorResponse('NOT_IN_FAMILY', 403)
    if (callerProfile.role !== 'admin') return errorResponse('NOT_ADMIN', 403)

    const { data: chore } = await admin
      .from('chores')
      .select('id, family_id, status, recurrence_type')
      .eq('id', chore_id)
      .single()
    if (!chore) return errorResponse('CHORE_NOT_FOUND', 404)
    if (chore.family_id !== callerProfile.family_id) return errorResponse('NOT_IN_FAMILY', 403)
    if (chore.status !== 'active') return errorResponse('CHORE_NOT_FOUND', 404)

    // Non-recurring: only one assignee allowed
    if (chore.recurrence_type === 'none' && user_ids.length > 1) {
      return errorResponse('TOO_MANY_ASSIGNEES', 422)
    }

    // Verify all user_ids belong to the same family
    const { data: targetProfiles, count } = await admin
      .from('profiles')
      .select('id', { count: 'exact' })
      .in('id', user_ids)
      .eq('family_id', callerProfile.family_id)
    if ((count ?? 0) !== user_ids.length) return errorResponse('NOT_IN_FAMILY', 403)

    const weekStart = getWeekStart(new Date())
    const rows = user_ids.map((uid: string) => ({
      chore_id,
      user_id: uid,
      week_start: weekStart,
      status: 'pending',
      archived: false,
      reminder_enabled: false,
      assigned_by: user.id,
    }))

    const { error: insertErr } = await admin
      .from('chore_assignments')
      .insert(rows)
    // ON CONFLICT: the DB unique constraint handles duplicates silently via upsert pattern
    // We use insert and ignore conflict errors for individual rows
    if (insertErr && insertErr.code !== '23505') {
      console.log(JSON.stringify({ event: 'admin_assign_error', message: insertErr.message, chore_id, ts: new Date().toISOString() }))
      return errorResponse('INTERNAL_ERROR', 500)
    }

    if (chore.recurrence_type === 'none') {
      await admin.from('chores').update({ is_pool_visible: false }).eq('id', chore_id)
    }

    // Notifications for each assignee
    const notifications = user_ids.map((uid: string) => ({
      user_id: uid,
      family_id: callerProfile.family_id,
      type: 'chore_assigned',
      title_he: 'משימה חדשה שויכה אליך',
      body_he: 'בדוק את הדשבורד שלך',
      related_entity_id: chore_id,
    }))
    await admin.from('notifications').insert(notifications)

    console.log(JSON.stringify({ event: 'admin_chore_assigned', chore_id, user_ids, assigned_by: user.id, ts: new Date().toISOString() }))

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.log(JSON.stringify({ event: 'admin_assign_error', message: String(err), ts: new Date().toISOString() }))
    return errorResponse('INTERNAL_ERROR', 500)
  }
})
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy admin-assign-chore
```

Expected: `Deployed admin-assign-chore`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-assign-chore/
git commit -m "feat: add admin-assign-chore Edge Function with family validation and multi-player support"
```

---

## Task 5: TypeScript error map utility

**Files:**
- Create: `src/lib/assignmentErrors.ts`

The client needs to convert Edge Function error codes to Hebrew messages. This is shared between the pool page and any future admin pool-assign UI.

- [ ] **Step 1: Create `src/lib/assignmentErrors.ts`**

```typescript
export const ASSIGNMENT_ERRORS: Record<string, string> = {
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

export function assignmentErrorMessage(code: string): string {
  return ASSIGNMENT_ERRORS[code] ?? ASSIGNMENT_ERRORS.INTERNAL_ERROR
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/assignmentErrors.ts
git commit -m "feat: add client-side assignment error code to Hebrew message map"
```

---

## Task 6: `SlotPickerSheet` component (TDD)

**Files:**
- Create: `src/components/player/__tests__/SlotPickerSheet.test.tsx`
- Create: `src/components/player/SlotPickerSheet.tsx`

This bottom sheet opens when a player taps the checkmark on a pool task. It lets them choose a day and time slot before confirming the self-assign.

- [ ] **Step 1: Write the failing tests**

Create `src/components/player/__tests__/SlotPickerSheet.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SlotPickerSheet from '../SlotPickerSheet'

const defaultProps = {
  open: true,
  choreTitle: 'כלי מטבח',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

describe('SlotPickerSheet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders chore title', () => {
    render(<SlotPickerSheet {...defaultProps} />)
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
  })

  it('renders Hebrew day buttons', () => {
    render(<SlotPickerSheet {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'ראשון' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שבת' })).toBeInTheDocument()
  })

  it('renders slot options', () => {
    render(<SlotPickerSheet {...defaultProps} />)
    expect(screen.getByLabelText('בוקר-צהריים')).toBeInTheDocument()
    expect(screen.getByLabelText('צהריים-אחה"צ')).toBeInTheDocument()
    expect(screen.getByLabelText('אחה"צ-ערב')).toBeInTheDocument()
    expect(screen.getByLabelText('ללא שיוך')).toBeInTheDocument()
  })

  it('renders confirm and cancel buttons', () => {
    render(<SlotPickerSheet {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'שייך אליי' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeInTheDocument()
  })

  it('calls onConfirm with selected day and slot', async () => {
    const onConfirm = vi.fn()
    render(<SlotPickerSheet {...defaultProps} onConfirm={onConfirm} />)

    // Select Wednesday (index 3)
    await userEvent.click(screen.getByRole('button', { name: 'רביעי' }))
    // Select morning slot
    await userEvent.click(screen.getByLabelText('בוקר-צהריים'))
    // Confirm
    await userEvent.click(screen.getByRole('button', { name: 'שייך אליי' }))

    expect(onConfirm).toHaveBeenCalledWith({ calendarDay: 3, calendarSlot: 'morning' })
  })

  it('calls onConfirm with null slot when "ללא שיוך" selected', async () => {
    const onConfirm = vi.fn()
    render(<SlotPickerSheet {...defaultProps} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByLabelText('ללא שיוך'))
    await userEvent.click(screen.getByRole('button', { name: 'שייך אליי' }))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ calendarSlot: null }))
  })

  it('calls onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn()
    render(<SlotPickerSheet {...defaultProps} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('renders nothing when open is false', () => {
    render(<SlotPickerSheet {...defaultProps} open={false} />)
    expect(screen.queryByText('כלי מטבח')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/components/player/__tests__/SlotPickerSheet.test.tsx
```

Expected: FAIL — `SlotPickerSheet.tsx` does not exist.

- [ ] **Step 3: Create `src/components/player/SlotPickerSheet.tsx`**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/components/player/__tests__/SlotPickerSheet.test.tsx
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/player/SlotPickerSheet.tsx src/components/player/__tests__/SlotPickerSheet.test.tsx
git commit -m "feat: add SlotPickerSheet component for day and slot selection"
```

---

## Task 7: Rewrite `ChorePoolPage` (TDD)

**Files:**
- Modify: `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx`
- Modify: `src/pages/player/chores/ChorePoolPage.tsx`

Key changes:
1. Pool filter uses `is_pool_visible` instead of `assigned_to === null`
2. Recurring tasks always show even if the player already has an assignment for them
3. "קח משימה" button replaced with a checkmark (☐) that opens `SlotPickerSheet`
4. Self-assign calls the `self-assign-chore` Edge Function instead of direct DB insert
5. On success: recurring tasks stay; non-recurring tasks disappear

- [ ] **Step 1: Write the updated failing tests**

Replace `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'

vi.mock('../../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../hooks/useChoreAssignments', () => ({
  useChoreAssignments: vi.fn(() => ({ assignments: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', family_id: 'f1' } }),
}))
vi.mock('../../../../lib/weekStart', () => ({
  getCurrentWeekStart: vi.fn(() => '2026-04-13'),
}))

const mockFunctions = vi.fn()
vi.mock('../../../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockFunctions(...args) } },
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import { useChores } from '../../../../hooks/useChores'
import { useChoreAssignments } from '../../../../hooks/useChoreAssignments'
import ChorePoolPage from '../ChorePoolPage'

const mockUseChores = vi.mocked(useChores)
const mockUseChoreAssignments = vi.mocked(useChoreAssignments)

const nonRecurringChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', coin_value: 10,
  difficulty: 'easy' as const, assigned_to: null, recurrence_type: 'none' as const,
  status: 'active' as const, is_pool_visible: true,
  description: null, proposed_by: null, approved_by: null,
  due_date: null, last_traded_price: null,
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

const recurringChore = {
  ...nonRecurringChore,
  id: 'c2', title: 'להאכיל חיות', recurrence_type: 'daily' as const,
  is_pool_visible: true,
}

const existingAssignment = {
  id: 'a1', chore_id: 'c2', user_id: 'p1', week_start: '2026-04-13',
  calendar_day: null, calendar_slot: null, reminder_enabled: false,
  status: 'pending' as const, archived: false, assigned_by: 'p1',
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

function renderPoolPage() {
  return render(<MemoryRouter><ChorePoolPage /></MemoryRouter>)
}

describe('ChorePoolPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
  })

  it('shows loading spinner while loading', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: true, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no visible chores', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('אין משימות זמינות כרגע.')).toBeInTheDocument()
  })

  it('shows pool chore with checkmark button', () => {
    mockUseChores.mockReturnValue({ chores: [nonRecurringChore], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /שייך אליי|☐|בחר משימה/ })).toBeInTheDocument()
  })

  it('hides non-recurring chore when is_pool_visible is false', () => {
    const hidden = { ...nonRecurringChore, is_pool_visible: false }
    mockUseChores.mockReturnValue({ chores: [hidden], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.queryByText('כלי מטבח')).not.toBeInTheDocument()
  })

  it('shows recurring chore even when player already has an assignment for it', () => {
    mockUseChores.mockReturnValue({ chores: [recurringChore], loading: false, error: null, refetch: vi.fn() })
    mockUseChoreAssignments.mockReturnValue({ assignments: [existingAssignment], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('להאכיל חיות')).toBeInTheDocument()
  })

  it('opens slot picker sheet when checkmark button clicked', async () => {
    mockUseChores.mockReturnValue({ chores: [nonRecurringChore], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: /☐|בחר/ }))
    expect(screen.getByRole('button', { name: 'שייך אליי' })).toBeInTheDocument()
  })

  it('calls self-assign-chore Edge Function on confirm and navigates for non-recurring', async () => {
    mockUseChores.mockReturnValue({ chores: [nonRecurringChore], loading: false, error: null, refetch: vi.fn() })
    mockFunctions.mockResolvedValue({ data: { ok: true }, error: null })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: /☐|בחר/ }))
    await userEvent.click(screen.getByRole('button', { name: 'שייך אליי' }))
    await waitFor(() => {
      expect(mockFunctions).toHaveBeenCalledWith('self-assign-chore', expect.objectContaining({
        body: expect.objectContaining({ chore_id: 'c1' }),
      }))
      expect(mockNavigate).toHaveBeenCalledWith('/player')
    })
  })

  it('stays on pool page (recurring stays visible) after self-assigning recurring chore', async () => {
    mockUseChores.mockReturnValue({ chores: [recurringChore], loading: false, error: null, refetch: vi.fn() })
    mockFunctions.mockResolvedValue({ data: { ok: true }, error: null })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: /☐|בחר/ }))
    await userEvent.click(screen.getByRole('button', { name: 'שייך אליי' }))
    await waitFor(() => expect(mockFunctions).toHaveBeenCalled())
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows Hebrew error message when Edge Function returns error', async () => {
    mockUseChores.mockReturnValue({ chores: [nonRecurringChore], loading: false, error: null, refetch: vi.fn() })
    mockFunctions.mockResolvedValue({ data: null, error: { message: 'CHORE_TAKEN' } })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: /☐|בחר/ }))
    await userEvent.click(screen.getByRole('button', { name: 'שייך אליי' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('המשימה כבר נלקחה על ידי שחקן אחר'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/pages/player/chores/__tests__/ChorePoolPage.test.tsx
```

Expected: several FAIL — old pick-up behaviour doesn't match new spec.

- [ ] **Step 3: Rewrite `ChorePoolPage.tsx`**

Replace the entire content of `src/pages/player/chores/ChorePoolPage.tsx`:

```typescript
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useChores } from '../../../hooks/useChores'
import { useChoreAssignments } from '../../../hooks/useChoreAssignments'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent } from '../../../components/ui/card'
import SlotPickerSheet from '../../../components/player/SlotPickerSheet'
import { assignmentErrorMessage } from '../../../lib/assignmentErrors'
import type { ChoreDifficulty, CalendarSlot } from '../../../types/database'

const difficultyLabel: Record<ChoreDifficulty, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
}

export default function ChorePoolPage() {
  const { profile } = useAuth()
  const { chores, loading: choresLoading, refetch } = useChores()
  const { assignments } = useChoreAssignments(profile?.id)
  const navigate = useNavigate()

  const [pendingChoreId, setPendingChoreId] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pool filter:
  // - Only active, is_pool_visible chores
  // - Non-recurring: hide if player already has any assignment for it this week
  // - Recurring: always show (player can self-assign multiple times to different slots)
  const nonRecurringAssignedIds = new Set(
    assignments
      .filter(a => {
        const chore = chores.find(c => c.id === a.chore_id)
        return chore?.recurrence_type === 'none'
      })
      .map(a => a.chore_id)
  )

  const poolChores = chores.filter(c => {
    if (c.status !== 'active' || !c.is_pool_visible) return false
    if (c.recurrence_type === 'none') return !nonRecurringAssignedIds.has(c.id)
    return true
  })

  const pendingChore = pendingChoreId ? chores.find(c => c.id === pendingChoreId) ?? null : null

  async function handleConfirm({
    calendarDay,
    calendarSlot,
  }: {
    calendarDay: number
    calendarSlot: CalendarSlot | null
  }) {
    if (!pendingChoreId || !pendingChore) return
    setAssigning(true)
    setError(null)

    const { data, error: fnError } = await supabase.functions.invoke('self-assign-chore', {
      body: {
        chore_id: pendingChoreId,
        calendar_day: calendarDay,
        calendar_slot: calendarSlot,
      },
    })

    setAssigning(false)
    setPendingChoreId(null)

    if (fnError || !data?.ok) {
      const code = fnError?.message ?? 'INTERNAL_ERROR'
      setError(assignmentErrorMessage(code))
      return
    }

    if (pendingChore.recurrence_type === 'none') {
      navigate('/player')
    } else {
      refetch()
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/player">← חזרה</Link>
        </Button>
        <h1 className="text-2xl font-bold">בחר משימה</h1>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {choresLoading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : poolChores.length === 0 ? (
        <p className="text-muted-foreground">אין משימות זמינות כרגע.</p>
      ) : (
        <div className="space-y-3">
          {poolChores.map(chore => (
            <Card key={chore.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{chore.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground">{chore.coin_value} מטבעות</span>
                    <Badge variant="secondary">{difficultyLabel[chore.difficulty]}</Badge>
                    {chore.recurrence_type !== 'none' && (
                      <Badge variant="outline" className="text-xs">🔁</Badge>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={assigning && pendingChoreId === chore.id}
                  onClick={() => {
                    setError(null)
                    setPendingChoreId(chore.id)
                  }}
                  aria-label={`בחר ${chore.title}`}
                >
                  ☐ בחר
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pendingChore && (
        <SlotPickerSheet
          open={true}
          choreTitle={pendingChore.title}
          onConfirm={handleConfirm}
          onCancel={() => setPendingChoreId(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/pages/player/chores/__tests__/ChorePoolPage.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Verify `useChores` hook returns `is_pool_visible`**

Open `src/hooks/useChores.ts`. Check that the Supabase `.select()` call uses `'*'` or explicitly includes `is_pool_visible`. If it uses a named column list without `is_pool_visible`, add it. If it uses `'*'`, no change needed.

- [ ] **Step 6: Commit**

```bash
git add src/pages/player/chores/ChorePoolPage.tsx src/pages/player/chores/__tests__/ChorePoolPage.test.tsx
git commit -m "feat: replace pick-up button with checkmark SlotPickerSheet; fix recurring pool filter"
```

---

## Task 8: ChoreFormPage — daily schedule multi-player per day (TDD)

**Files:**
- Modify: `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx`
- Modify: `src/pages/admin/chores/ChoreFormPage.tsx`

Currently the daily schedule stores `Record<number, string>` (one player per day). Change it to `Record<number, string[]>` (multiple players per day), with a checkbox list per day instead of a dropdown.

- [ ] **Step 1: Add the new failing tests**

Append these tests to the bottom of the existing `describe` blocks in `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx`:

```typescript
describe('ChoreFormPage — daily schedule multi-player', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows checkboxes per day member when daily recurrence selected', async () => {
    renderCreate()
    // Select daily recurrence
    await userEvent.click(screen.getByRole('combobox', { name: 'סוג חזרה' }))
    await userEvent.click(screen.getByRole('option', { name: 'יומי' }))
    // Should show a checkbox for the member (דנה) for Sunday (ראשון)
    expect(screen.getByRole('checkbox', { name: 'ראשון — דנה' })).toBeInTheDocument()
  })

  it('allows multiple players to be checked for the same day', async () => {
    // Add second member to the mock
    vi.mocked(require('../../../../hooks/useFamilyMembers').useFamilyMembers).mockReturnValue({
      members: [
        { id: 'p1', name: 'דנה', role: 'player' },
        { id: 'p2', name: 'יוסי', role: 'player' },
      ],
      loading: false,
      error: null,
    })
    renderCreate()
    await userEvent.click(screen.getByRole('combobox', { name: 'סוג חזרה' }))
    await userEvent.click(screen.getByRole('option', { name: 'יומי' }))

    await userEvent.click(screen.getByRole('checkbox', { name: 'ראשון — דנה' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'ראשון — יוסי' }))

    expect(screen.getByRole('checkbox', { name: 'ראשון — דנה' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'ראשון — יוסי' })).toBeChecked()
  })

  it('saves multiple schedule rows for same day when daily multi-player is configured', async () => {
    vi.mocked(require('../../../../hooks/useFamilyMembers').useFamilyMembers).mockReturnValue({
      members: [
        { id: 'p1', name: 'דנה', role: 'player' },
        { id: 'p2', name: 'יוסי', role: 'player' },
      ],
      loading: false,
      error: null,
    })

    const insertMock = vi.fn().mockResolvedValue({ error: null })
    const deleteMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'chores') return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
      }
      if (table === 'chore_schedule') return {
        delete: deleteMock,
        insert: insertMock,
      }
      return { insert: vi.fn().mockResolvedValue({ error: null }) }
    })

    renderCreate()
    await userEvent.type(screen.getByLabelText('שם המשימה'), 'להאכיל חיות')
    await userEvent.click(screen.getByRole('combobox', { name: 'סוג חזרה' }))
    await userEvent.click(screen.getByRole('option', { name: 'יומי' }))

    // Check both players for Sunday
    await userEvent.click(screen.getByRole('checkbox', { name: 'ראשון — דנה' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'ראשון — יוסי' }))
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ day_of_week: 0, assigned_to: 'p1' }),
          expect.objectContaining({ day_of_week: 0, assigned_to: 'p2' }),
        ])
      )
    })
  })
})
```

- [ ] **Step 2: Run new tests to verify they fail**

```bash
npm run test:run -- src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx
```

Expected: new tests FAIL — current implementation uses a single dropdown per day.

- [ ] **Step 3: Update `ChoreFormPage.tsx` — change `dailySchedule` type and render checkboxes**

In `src/pages/admin/chores/ChoreFormPage.tsx`:

**Change the state declaration** (line ~36):
```typescript
// Before:
const [dailySchedule, setDailySchedule] = useState<Record<number, string>>({})
// After:
const [dailySchedule, setDailySchedule] = useState<Record<number, string[]>>({})
```

**Change the edit-mode loading** (inside the `chore_schedule` useEffect, around line 68–73):
```typescript
// Before:
if (row.day_of_week !== null) daily[row.day_of_week] = row.assigned_to
// After:
if (row.day_of_week !== null) {
  daily[row.day_of_week] = [...(daily[row.day_of_week] ?? []), row.assigned_to]
}
```

**Change the schedule rows builder** (inside `handleSubmit`, around line 116–122):
```typescript
// Before:
recurrenceType === 'daily'
  ? Object.entries(dailySchedule)
      .filter(([, userId]) => userId && userId !== 'none')
      .map(([day, userId]) => ({
        chore_id: choreId,
        day_of_week: Number(day),
        assigned_to: userId,
      }))
// After:
recurrenceType === 'daily'
  ? Object.entries(dailySchedule).flatMap(([day, userIds]) =>
      userIds.map(userId => ({
        chore_id: choreId,
        day_of_week: Number(day),
        assigned_to: userId,
      }))
    )
```

**Replace the daily schedule JSX** (the `{recurrenceType === 'daily' && ...}` block, around lines 243–269):
```typescript
{recurrenceType === 'daily' && (
  <div className="space-y-3">
    <Label>תזמון יומי</Label>
    {DAY_NAMES.map((dayName, dayIndex) => (
      <div key={dayName}>
        <p className="text-sm font-medium mb-1">{dayName}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 pr-2">
          {members.map(m => {
            const checked = (dailySchedule[dayIndex] ?? []).includes(m.id)
            return (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  aria-label={`${dayName} — ${m.name}`}
                  checked={checked}
                  onChange={e => {
                    setDailySchedule(prev => {
                      const current = prev[dayIndex] ?? []
                      return {
                        ...prev,
                        [dayIndex]: e.target.checked
                          ? [...current, m.id]
                          : current.filter(id => id !== m.id),
                      }
                    })
                  }}
                  className="h-4 w-4 rounded border-input"
                />
                <span className="text-sm">{m.name}</span>
              </label>
            )
          })}
        </div>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 4: Run all ChoreFormPage tests**

```bash
npm run test:run -- src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx
```

Expected: all tests PASS (including pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/chores/ChoreFormPage.tsx src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx
git commit -m "feat: daily schedule supports multiple players per day via checkboxes"
```

---

## Task 9: Calendar mobile overflow collapse

**Files:**
- Modify: `src/components/calendar/WeeklyCalendarGrid.tsx`

The desktop calendar already renders all cards per cell. Mobile needs an overflow collapse: show max 2 cards, then "ועוד N משימות ▾" that expands inline.

- [ ] **Step 1: Add `SlotCell` sub-component inside `WeeklyCalendarGrid.tsx`**

Add this new component just before the `WeeklyCalendarGrid` export function (after the existing `AssignmentCard` component):

```typescript
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
      {visibleCards.map(renderCard)}
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
```

- [ ] **Step 2: Update the mobile view to use `SlotCell`**

In the mobile section of `WeeklyCalendarGrid` (the `landscape:hidden md:hidden` div), replace the current slot `<div>` with `SlotCell`. Find the block:

```typescript
<div
  className={`min-h-[56px] rounded p-2 space-y-1 transition-colors ${cellClass(selectedDay, slot.key, '')}`}
  data-testid={`cell-${selectedDay}-${slot.key}`}
  onDragOver={(e) => handleDragOver(e, selectedDay, slot.key)}
  onDragLeave={() => setDragOverCell(null)}
  onDrop={(e) => handleDrop(e, selectedDay, slot.key)}
>
  {cards.length === 0 ? (
    <p className="text-xs text-muted-foreground/60 pt-1">גרור לכאן</p>
  ) : (
    cards.map(renderCard)
  )}
</div>
```

Replace with:

```typescript
<SlotCell
  cards={cards}
  renderCard={renderCard}
  className={`min-h-[56px] rounded p-2 space-y-1 transition-colors ${cellClass(selectedDay, slot.key, '')}`}
  testId={`cell-${selectedDay}-${slot.key}`}
  onDragOver={(e) => handleDragOver(e, selectedDay, slot.key)}
  onDragLeave={() => setDragOverCell(null)}
  onDrop={(e) => handleDrop(e, selectedDay, slot.key)}
/>
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
npm run test:run
```

Expected: all pre-existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/WeeklyCalendarGrid.tsx
git commit -m "feat: add mobile overflow collapse to calendar slot cells (ועוד N משימות)"
```

---

## Task 10: Full test run and smoke test

- [ ] **Step 1: Run all tests**

```bash
npm run test:run
```

Expected: all tests PASS, no failures.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start dev server and smoke test**

```bash
npm run dev
```

Open `http://localhost:5173` and verify:

**Pool page:**
- Recurring tasks show even after you pick them up once
- Tapping "☐ בחר" opens the SlotPickerSheet
- Selecting a day + slot and confirming calls the Edge Function
- Non-recurring task disappears from pool after assignment; recurring stays

**Admin ChoreFormPage:**
- Selecting "יומי" recurrence shows checkboxes per day per member
- Multiple members can be checked for the same day
- Saving creates multiple `chore_schedule` rows

**Calendar:**
- Mobile: cells with 3+ cards show "ועוד N משימות ▾"; tapping expands
- Desktop: all cards visible in each cell

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete task pool multi-assignment — checkmark flow, recurring pool, daily multi-player, calendar stacking"
```

---

## Self-Review

| Spec requirement | Task |
|---|---|
| `is_pool_visible` column on chores | Task 1 |
| Explicit TRUE for recurring on creation | Task 1 (SQL UPDATE) |
| `assigned_by` column on chore_assignments | Task 1, 2 |
| New unique constraint incl. `calendar_slot` | Task 1 |
| Drop player INSERT RLS policy | Task 1 |
| UPDATE guard trigger (field-level) | Task 1 |
| TypeScript types updated | Task 2 |
| `self-assign-chore` Edge Function + input validation | Task 3 |
| `admin-assign-chore` Edge Function | Task 4 |
| Client-side error code map | Task 5 |
| SlotPickerSheet component | Task 6 |
| Pool page: recurring always visible | Task 7 |
| Pool page: checkmark replaces button | Task 7 |
| Pool page: non-recurring disappears when claimed | Task 7 |
| Daily schedule: multi-player per day (checkboxes) | Task 8 |
| Calendar mobile overflow collapse | Task 9 |
| Rate limiting (Upstash) | Edge Functions (Task 3/4) — Upstash provisioning is a manual infra step; add to deployment runbook |
| Structured logging in Edge Functions | Tasks 3, 4 |
| `FORBIDDEN_FIELD_UPDATE` in client error map | Task 5 |

> **Upstash rate limiting note:** The spec calls for Upstash Redis rate limiting inside the Edge Functions. This plan defers it as an infra step: provision the Upstash Redis instance from the Supabase Marketplace, add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as Edge Function secrets, then add `@upstash/ratelimit` integration to both functions. This is a hardening pass separate from the feature work and should be tracked as a follow-up task.
