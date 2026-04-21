# Penalty System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect overdue assignments, deduct coins at week-end via pg_cron, let admins waive/reverse penalties, and show penalty history on the player dashboard.

**Architecture:** Pure SQL + pg_cron. `apply_weekly_penalties()` is a SECURITY DEFINER function (REVOKE'd from all client roles) called by pg_cron Saturday 23:59. Admin waiver (pre-batch) and reversal (post-batch) are separate admin-only SECURITY DEFINER RPCs. React hooks wrap Supabase queries; admin page has three sections; player dashboard gets a new penalty history section.

**Tech Stack:** PostgreSQL (SECURITY DEFINER, pg_cron, REVOKE), Supabase, React 18 + TypeScript, Vitest + React Testing Library, shadcn/ui, Tailwind CSS, Hebrew RTL (`dir="rtl"`).

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/026_penalty_system.sql` | Create | DB migration: new columns, 4 RPCs, pg_cron schedule |
| `src/types/database.ts` | Modify | Add `PenaltyPolicy`, `PenaltyWithChore`, `AdminPenaltyRow`, `OverdueAssignmentWithDetails` interfaces |
| `src/hooks/usePenalties.ts` | Create | Player hook: fetches own penalty rows |
| `src/hooks/__tests__/usePenalties.test.ts` | Create | Tests for usePenalties |
| `src/hooks/useOverdueAssignments.ts` | Create | Admin hook: fetches overdue unwaived assignments + waive action |
| `src/hooks/__tests__/useOverdueAssignments.test.ts` | Create | Tests for useOverdueAssignments |
| `src/hooks/usePenaltyPolicy.ts` | Create | Admin hook: fetches policy row + update action |
| `src/hooks/__tests__/usePenaltyPolicy.test.ts` | Create | Tests for usePenaltyPolicy |
| `src/hooks/useAppliedPenalties.ts` | Create | Admin hook: fetches applied penalty rows + reverse action |
| `src/hooks/__tests__/useAppliedPenalties.test.ts` | Create | Tests for useAppliedPenalties |
| `src/pages/admin/penalties/PenaltiesPage.tsx` | Create | Admin page: policy editor, overdue list, applied penalties list |
| `src/pages/admin/penalties/__tests__/PenaltiesPage.test.tsx` | Create | Tests for PenaltiesPage |
| `src/router.tsx` | Modify | Add `/admin/penalties` route |
| `src/components/layout/AdminLayout.tsx` | Modify | Add "הפסדים" nav item |
| `src/pages/player/PlayerDashboard.tsx` | Modify | Add penalty history section at bottom |
| `src/pages/player/__tests__/PlayerDashboard.test.tsx` | Modify | Add penalty history tests |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/026_penalty_system.sql`

No unit tests for SQL migrations — correctness verified by later UI tests and manual Supabase apply.

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/026_penalty_system.sql

-- ── 1. chore_assignments: pre-batch waiver flag ─────────────────────────────
ALTER TABLE chore_assignments
  ADD COLUMN penalty_waived boolean NOT NULL DEFAULT false;

-- ── 2. penalties: batch audit trail ────────────────────────────────────────
-- waived_by, waived_at, applied_at already exist in schema.
ALTER TABLE penalties
  ADD COLUMN IF NOT EXISTS batch_id uuid;

-- ── 3. penalty_policy: update defaults ─────────────────────────────────────
ALTER TABLE penalty_policy
  ALTER COLUMN overdue_day_deduction  SET DEFAULT 1,
  ALTER COLUMN overdue_week_deduction SET DEFAULT 5;

-- Seed default policy rows for existing families without one.
-- apply_weekly_penalties iterates penalty_policy; families with no row are skipped.
INSERT INTO penalty_policy (family_id, overdue_day_deduction, overdue_week_deduction)
SELECT id, 1, 5
FROM families
WHERE id NOT IN (SELECT family_id FROM penalty_policy WHERE family_id IS NOT NULL)
ON CONFLICT DO NOTHING;

-- ── 4. apply_weekly_penalties() ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION apply_weekly_penalties()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r             RECORD;
  v_policy      penalty_policy%ROWTYPE;
  v_deduction   integer;
  v_batch_id    uuid := gen_random_uuid();
  v_user_family uuid;
BEGIN
  -- FOR UPDATE: prevents overlapping pg_cron runs from double-deducting.
  -- Each family row is locked until this transaction commits.
  FOR v_policy IN SELECT * FROM penalty_policy FOR UPDATE LOOP
    FOR r IN
      SELECT
        ca.id           AS assignment_id,
        ca.user_id,
        ca.calendar_day
      FROM chore_assignments ca
      WHERE ca.status        = 'overdue'
        AND ca.penalty_waived = false
        AND ca.archived       = false
        AND EXISTS (
          SELECT 1 FROM chores c
          WHERE c.id = ca.chore_id
            AND c.family_id = v_policy.family_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM penalties p
          WHERE p.chore_assignment_id = ca.id
        )
    LOOP
      -- Defense-in-depth: verify assignment user belongs to this family.
      SELECT family_id INTO v_user_family FROM profiles WHERE id = r.user_id;
      IF v_user_family IS DISTINCT FROM v_policy.family_id THEN
        RAISE LOG 'apply_weekly_penalties: skipping assignment % — user % family % ≠ policy family %',
          r.assignment_id, r.user_id, v_user_family, v_policy.family_id;
        CONTINUE;
      END IF;

      v_deduction := CASE
        WHEN r.calendar_day IS NOT NULL THEN v_policy.overdue_day_deduction
        ELSE v_policy.overdue_week_deduction
      END;

      -- Floor coins at zero; profiles.coins has no upper cap so reversal is always safe.
      UPDATE profiles
      SET coins      = GREATEST(0, coins - v_deduction),
          updated_at = now()
      WHERE id = r.user_id;

      -- Notification fires automatically via trg_notify_penalty_applied trigger.
      INSERT INTO penalties (chore_assignment_id, user_id, coin_deduction, reason, batch_id)
      VALUES (r.assignment_id, r.user_id, v_deduction, 'overdue', v_batch_id);
    END LOOP;
  END LOOP;
END;
$$;

-- Unreachable from client; only pg_cron (postgres owner) may call it.
REVOKE EXECUTE ON FUNCTION apply_weekly_penalties() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION apply_weekly_penalties() FROM authenticated;
REVOKE EXECUTE ON FUNCTION apply_weekly_penalties() FROM anon;

-- ── 5. waive_assignment_penalty(uuid) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION waive_assignment_penalty(p_assignment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment chore_assignments%ROWTYPE;
  v_chore      chores%ROWTYPE;
  v_admin_family uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Not authorized: admin only';
  END IF;

  SELECT * INTO v_assignment FROM chore_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  SELECT * INTO v_chore FROM chores WHERE id = v_assignment.chore_id;

  SELECT family_id INTO v_admin_family FROM profiles WHERE id = auth.uid();
  IF v_admin_family IS NULL OR v_admin_family <> v_chore.family_id THEN
    RAISE EXCEPTION 'Not authorized: not in same family';
  END IF;

  UPDATE chore_assignments
  SET penalty_waived = true
  WHERE id = p_assignment_id;
END;
$$;

-- ── 6. reverse_penalty(uuid) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reverse_penalty(p_penalty_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_penalty      penalties%ROWTYPE;
  v_admin_family uuid;
  v_user_family  uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Not authorized: admin only';
  END IF;

  SELECT * INTO v_penalty FROM penalties WHERE id = p_penalty_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Penalty not found';
  END IF;

  IF v_penalty.waived_by IS NOT NULL THEN
    RAISE EXCEPTION 'Penalty already reversed';
  END IF;

  SELECT family_id INTO v_admin_family FROM profiles WHERE id = auth.uid();
  SELECT family_id INTO v_user_family  FROM profiles WHERE id = v_penalty.user_id;
  IF v_admin_family IS NULL OR v_admin_family <> v_user_family THEN
    RAISE EXCEPTION 'Not authorized: not in same family';
  END IF;

  -- profiles.coins has no upper cap; this addition is always safe.
  UPDATE profiles
  SET coins      = coins + v_penalty.coin_deduction,
      updated_at = now()
  WHERE id = v_penalty.user_id;

  UPDATE penalties
  SET waived_by = auth.uid(),
      waived_at = now()
  WHERE id = p_penalty_id;
END;
$$;

-- ── 7. update_penalty_policy(int, int) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_penalty_policy(p_day_deduction int, p_week_deduction int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Not authorized: admin only';
  END IF;

  IF p_day_deduction <= 0 OR p_week_deduction <= 0 THEN
    RAISE EXCEPTION 'Deduction values must be greater than zero';
  END IF;

  SELECT family_id INTO v_family_id FROM profiles WHERE id = auth.uid();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'Admin has no family';
  END IF;

  INSERT INTO penalty_policy (family_id, overdue_day_deduction, overdue_week_deduction, updated_by, updated_at)
  VALUES (v_family_id, p_day_deduction, p_week_deduction, auth.uid(), now())
  ON CONFLICT (family_id) DO UPDATE
    SET overdue_day_deduction  = EXCLUDED.overdue_day_deduction,
        overdue_week_deduction = EXCLUDED.overdue_week_deduction,
        updated_by             = EXCLUDED.updated_by,
        updated_at             = EXCLUDED.updated_at;
END;
$$;

-- ── 8. pg_cron schedule ────────────────────────────────────────────────────
SELECT cron.schedule(
  'weekly-penalties',
  '59 23 * * 6',
  'SELECT apply_weekly_penalties()'
);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/026_penalty_system.sql
git commit -m "feat(db): add penalty system migration — columns, RPCs, pg_cron schedule"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/types/database.ts`

No runtime tests — verified by TypeScript compilation (`npm run build`).

- [ ] **Step 1: Add interfaces to `src/types/database.ts`**

Append after the existing interfaces (after the last `export interface` block):

```typescript
export interface PenaltyPolicy {
  id: string
  family_id: string
  overdue_day_deduction: number
  overdue_week_deduction: number
  per_chore_overrides: Record<string, number> | null
  updated_by: string | null
  updated_at: string
}

export interface PenaltyWithChore {
  id: string
  chore_assignment_id: string
  user_id: string
  coin_deduction: number
  reason: string
  waived_by: string | null
  waived_at: string | null
  applied_at: string
  batch_id: string | null
  chore_assignments: {
    chore_id: string
    chores: { title: string }
  }
}

export interface AdminPenaltyRow extends PenaltyWithChore {
  profiles: { name: string; avatar_url: string | null }
}

export interface OverdueAssignmentWithDetails {
  id: string
  chore_id: string
  user_id: string
  calendar_day: number | null
  calendar_slot: string | null
  penalty_waived: boolean
  chores: { title: string; coin_value: number }
  profiles: { name: string; avatar_url: string | null }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): add PenaltyPolicy, PenaltyWithChore, AdminPenaltyRow, OverdueAssignmentWithDetails"
```

---

## Task 3: `usePenalties` Hook (Player)

**Files:**
- Create: `src/hooks/usePenalties.ts`
- Create: `src/hooks/__tests__/usePenalties.test.ts`

Player hook. Fetches the authenticated user's own penalty rows (RLS restricts to own rows automatically).

- [ ] **Step 1: Write failing test**

```typescript
// src/hooks/__tests__/usePenalties.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'

import { usePenalties } from '../usePenalties'

const fakePenalty = {
  id: 'pen1',
  chore_assignment_id: 'a1',
  user_id: 'p1',
  coin_deduction: 1,
  reason: 'overdue',
  waived_by: null,
  waived_at: null,
  applied_at: '2026-04-19T23:59:00Z',
  batch_id: 'batch-uuid-1',
  chore_assignments: { chore_id: 'c1', chores: { title: 'כלי מטבח' } },
}

const fakePenaltyWaived = {
  ...fakePenalty,
  id: 'pen2',
  waived_by: 'admin1',
  waived_at: '2026-04-20T10:00:00Z',
}

function makeFromMock(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
  mockFrom.mockReturnValue(builder)
  return builder
}

describe('usePenalties', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    makeFromMock(null)
    const { result } = renderHook(() => usePenalties())
    expect(result.current.loading).toBe(true)
  })

  it('returns penalties on success', async () => {
    makeFromMock([fakePenalty, fakePenaltyWaived])
    const { result } = renderHook(() => usePenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.penalties).toHaveLength(2)
    expect(result.current.penalties[0].id).toBe('pen1')
    expect(result.current.error).toBeNull()
  })

  it('marks waived penalty correctly', async () => {
    makeFromMock([fakePenaltyWaived])
    const { result } = renderHook(() => usePenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.penalties[0].waived_by).toBe('admin1')
  })

  it('returns empty array when no penalties', async () => {
    makeFromMock([])
    const { result } = renderHook(() => usePenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.penalties).toHaveLength(0)
  })

  it('sets error on failure', async () => {
    makeFromMock(null, { message: 'DB error' })
    const { result } = renderHook(() => usePenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
    expect(result.current.penalties).toHaveLength(0)
  })

  it('queries penalties table with correct select and order', async () => {
    const builder = makeFromMock([])
    const { result } = renderHook(() => usePenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFrom).toHaveBeenCalledWith('penalties')
    expect(builder.select).toHaveBeenCalledWith(
      '*, chore_assignments(chore_id, chores(title))'
    )
    expect(builder.order).toHaveBeenCalledWith('applied_at', { ascending: false })
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/hooks/__tests__/usePenalties.test.ts --reporter=verbose`
Expected: FAIL — `Cannot find module '../usePenalties'`

- [ ] **Step 3: Implement `src/hooks/usePenalties.ts`**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { PenaltyWithChore } from '../types/database'

export interface UsePenaltiesResult {
  penalties: PenaltyWithChore[]
  loading: boolean
  error: string | null
}

export function usePenalties(): UsePenaltiesResult {
  const [penalties, setPenalties] = useState<PenaltyWithChore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPenalties = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('penalties')
      .select('*, chore_assignments(chore_id, chores(title))')
      .order('applied_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setPenalties((data as PenaltyWithChore[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPenalties()
  }, [fetchPenalties])

  return { penalties, loading, error }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run src/hooks/__tests__/usePenalties.test.ts --reporter=verbose`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePenalties.ts src/hooks/__tests__/usePenalties.test.ts
git commit -m "feat(hooks): add usePenalties — player penalty history hook"
```

---

## Task 4: Admin Data Hooks

**Files:**
- Create: `src/hooks/useOverdueAssignments.ts`
- Create: `src/hooks/__tests__/useOverdueAssignments.test.ts`
- Create: `src/hooks/usePenaltyPolicy.ts`
- Create: `src/hooks/__tests__/usePenaltyPolicy.test.ts`
- Create: `src/hooks/useAppliedPenalties.ts`
- Create: `src/hooks/__tests__/useAppliedPenalties.test.ts`

Three admin hooks: overdue list with waive action, policy reader/updater, applied penalties list with reverse action.

### 4a: `useOverdueAssignments`

- [ ] **Step 1: Write failing test**

```typescript
// src/hooks/__tests__/useOverdueAssignments.test.ts
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../test/mocks/supabase'

import { useOverdueAssignments } from '../useOverdueAssignments'

const fakeAssignment = {
  id: 'a1',
  chore_id: 'c1',
  user_id: 'p1',
  calendar_day: 1,
  calendar_slot: 'morning',
  penalty_waived: false,
  chores: { title: 'כלי מטבח', coin_value: 10 },
  profiles: { name: 'דנה', avatar_url: null },
}

function makeFromMock(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
  mockFrom.mockReturnValue(builder)
  return builder
}

describe('useOverdueAssignments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts loading', () => {
    makeFromMock(null)
    const { result } = renderHook(() => useOverdueAssignments())
    expect(result.current.loading).toBe(true)
  })

  it('returns overdue assignments on success', async () => {
    makeFromMock([fakeAssignment])
    const { result } = renderHook(() => useOverdueAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.assignments).toHaveLength(1)
    expect(result.current.assignments[0].id).toBe('a1')
  })

  it('sets error on failure', async () => {
    makeFromMock(null, { message: 'DB error' })
    const { result } = renderHook(() => useOverdueAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
  })

  it('waive calls waive_assignment_penalty RPC', async () => {
    makeFromMock([fakeAssignment])
    mockRpc.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useOverdueAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.waive('a1')
    })
    expect(mockRpc).toHaveBeenCalledWith('waive_assignment_penalty', { p_assignment_id: 'a1' })
  })

  it('waive returns error message on RPC failure', async () => {
    makeFromMock([])
    mockRpc.mockResolvedValue({ error: { message: 'Not authorized' } })
    const { result } = renderHook(() => useOverdueAssignments())
    await waitFor(() => expect(result.current.loading).toBe(false))
    let res: { error: string | null }
    await act(async () => {
      res = await result.current.waive('a1')
    })
    expect(res!.error).toBe('Not authorized')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/hooks/__tests__/useOverdueAssignments.test.ts --reporter=verbose`
Expected: FAIL — `Cannot find module '../useOverdueAssignments'`

- [ ] **Step 3: Implement `src/hooks/useOverdueAssignments.ts`**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { OverdueAssignmentWithDetails } from '../types/database'

export interface UseOverdueAssignmentsResult {
  assignments: OverdueAssignmentWithDetails[]
  loading: boolean
  error: string | null
  waive: (assignmentId: string) => Promise<{ error: string | null }>
  refetch: () => void
}

export function useOverdueAssignments(): UseOverdueAssignmentsResult {
  const [assignments, setAssignments] = useState<OverdueAssignmentWithDetails[]>([])
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
    const { data, error } = await supabase
      .from('chore_assignments')
      .select('id, chore_id, user_id, calendar_day, calendar_slot, penalty_waived, chores(title, coin_value), profiles!user_id(name, avatar_url)')
      .eq('status', 'overdue')
      .eq('penalty_waived', false)
      .eq('archived', false)
      .order('created_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setAssignments((data as OverdueAssignmentWithDetails[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAssignments()
  }, [fetchAssignments])

  async function waive(assignmentId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('waive_assignment_penalty', { p_assignment_id: assignmentId })
    if (error) return { error: error.message }
    fetchAssignments()
    return { error: null }
  }

  return { assignments, loading, error, waive, refetch: fetchAssignments }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run src/hooks/__tests__/useOverdueAssignments.test.ts --reporter=verbose`
Expected: 5 tests PASS

### 4b: `usePenaltyPolicy`

- [ ] **Step 5: Write failing test**

```typescript
// src/hooks/__tests__/usePenaltyPolicy.test.ts
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../test/mocks/supabase'

import { usePenaltyPolicy } from '../usePenaltyPolicy'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { family_id: 'f1' } }),
}))

const fakePolicy = {
  id: 'pol1',
  family_id: 'f1',
  overdue_day_deduction: 1,
  overdue_week_deduction: 5,
  per_chore_overrides: null,
  updated_by: null,
  updated_at: '2026-04-01T00:00:00Z',
}

function makeFromMock(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  }
  mockFrom.mockReturnValue(builder)
  return builder
}

describe('usePenaltyPolicy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts loading', () => {
    makeFromMock(null)
    const { result } = renderHook(() => usePenaltyPolicy())
    expect(result.current.loading).toBe(true)
  })

  it('returns policy on success', async () => {
    makeFromMock(fakePolicy)
    const { result } = renderHook(() => usePenaltyPolicy())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.policy?.overdue_day_deduction).toBe(1)
    expect(result.current.policy?.overdue_week_deduction).toBe(5)
  })

  it('returns null policy when no row exists', async () => {
    makeFromMock(null)
    const { result } = renderHook(() => usePenaltyPolicy())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.policy).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('sets error on failure', async () => {
    makeFromMock(null, { message: 'DB error' })
    const { result } = renderHook(() => usePenaltyPolicy())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
  })

  it('update calls update_penalty_policy RPC', async () => {
    makeFromMock(fakePolicy)
    mockRpc.mockResolvedValue({ error: null })
    const { result } = renderHook(() => usePenaltyPolicy())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.update(2, 10)
    })
    expect(mockRpc).toHaveBeenCalledWith('update_penalty_policy', {
      p_day_deduction: 2,
      p_week_deduction: 10,
    })
  })
})
```

- [ ] **Step 6: Run test — verify it fails**

Run: `npx vitest run src/hooks/__tests__/usePenaltyPolicy.test.ts --reporter=verbose`
Expected: FAIL — `Cannot find module '../usePenaltyPolicy'`

- [ ] **Step 7: Implement `src/hooks/usePenaltyPolicy.ts`**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { PenaltyPolicy } from '../types/database'

export interface UsePenaltyPolicyResult {
  policy: PenaltyPolicy | null
  loading: boolean
  error: string | null
  update: (dayDeduction: number, weekDeduction: number) => Promise<{ error: string | null }>
}

export function usePenaltyPolicy(): UsePenaltyPolicyResult {
  const { profile } = useAuth()
  const [policy, setPolicy] = useState<PenaltyPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPolicy = useCallback(async () => {
    if (!profile?.family_id) return
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('penalty_policy')
      .select('*')
      .eq('family_id', profile.family_id)
      .maybeSingle()
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setPolicy(data as PenaltyPolicy | null)
    }
    setLoading(false)
  }, [profile?.family_id])

  useEffect(() => {
    fetchPolicy()
  }, [fetchPolicy])

  async function update(dayDeduction: number, weekDeduction: number): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('update_penalty_policy', {
      p_day_deduction: dayDeduction,
      p_week_deduction: weekDeduction,
    })
    if (error) return { error: error.message }
    fetchPolicy()
    return { error: null }
  }

  return { policy, loading, error, update }
}
```

- [ ] **Step 8: Run test — verify it passes**

Run: `npx vitest run src/hooks/__tests__/usePenaltyPolicy.test.ts --reporter=verbose`
Expected: 5 tests PASS

### 4c: `useAppliedPenalties`

- [ ] **Step 9: Write failing test**

```typescript
// src/hooks/__tests__/useAppliedPenalties.test.ts
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../test/mocks/supabase'

import { useAppliedPenalties } from '../useAppliedPenalties'

const fakePenalty = {
  id: 'pen1',
  chore_assignment_id: 'a1',
  user_id: 'p1',
  coin_deduction: 1,
  reason: 'overdue',
  waived_by: null,
  waived_at: null,
  applied_at: '2026-04-19T23:59:00Z',
  batch_id: 'batch-1',
  chore_assignments: { chore_id: 'c1', chores: { title: 'כלי מטבח' } },
  profiles: { name: 'דנה', avatar_url: null },
}

const fakeReversedPenalty = {
  ...fakePenalty,
  id: 'pen2',
  waived_by: 'admin1',
  waived_at: '2026-04-20T10:00:00Z',
}

function makeFromMock(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  }
  mockFrom.mockReturnValue(builder)
  return builder
}

describe('useAppliedPenalties', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts loading', () => {
    makeFromMock(null)
    const { result } = renderHook(() => useAppliedPenalties())
    expect(result.current.loading).toBe(true)
  })

  it('returns penalties including reversed ones', async () => {
    makeFromMock([fakePenalty, fakeReversedPenalty])
    const { result } = renderHook(() => useAppliedPenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.penalties).toHaveLength(2)
    expect(result.current.penalties[1].waived_by).toBe('admin1')
  })

  it('sets error on failure', async () => {
    makeFromMock(null, { message: 'DB error' })
    const { result } = renderHook(() => useAppliedPenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
  })

  it('reverse calls reverse_penalty RPC', async () => {
    makeFromMock([fakePenalty])
    mockRpc.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useAppliedPenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      await result.current.reverse('pen1')
    })
    expect(mockRpc).toHaveBeenCalledWith('reverse_penalty', { p_penalty_id: 'pen1' })
  })

  it('reverse returns error on RPC failure', async () => {
    makeFromMock([])
    mockRpc.mockResolvedValue({ error: { message: 'Already reversed' } })
    const { result } = renderHook(() => useAppliedPenalties())
    await waitFor(() => expect(result.current.loading).toBe(false))
    let res: { error: string | null }
    await act(async () => {
      res = await result.current.reverse('pen1')
    })
    expect(res!.error).toBe('Already reversed')
  })
})
```

- [ ] **Step 10: Run test — verify it fails**

Run: `npx vitest run src/hooks/__tests__/useAppliedPenalties.test.ts --reporter=verbose`
Expected: FAIL — `Cannot find module '../useAppliedPenalties'`

- [ ] **Step 11: Implement `src/hooks/useAppliedPenalties.ts`**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { AdminPenaltyRow } from '../types/database'

export interface UseAppliedPenaltiesResult {
  penalties: AdminPenaltyRow[]
  loading: boolean
  error: string | null
  reverse: (penaltyId: string) => Promise<{ error: string | null }>
  refetch: () => void
}

export function useAppliedPenalties(): UseAppliedPenaltiesResult {
  const [penalties, setPenalties] = useState<AdminPenaltyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchPenalties = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('penalties')
      .select('*, chore_assignments(chore_id, chores(title)), profiles!user_id(name, avatar_url)')
      .order('applied_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setPenalties((data as AdminPenaltyRow[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPenalties()
  }, [fetchPenalties])

  async function reverse(penaltyId: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('reverse_penalty', { p_penalty_id: penaltyId })
    if (error) return { error: error.message }
    fetchPenalties()
    return { error: null }
  }

  return { penalties, loading, error, reverse, refetch: fetchPenalties }
}
```

- [ ] **Step 12: Run all three hook tests — verify they all pass**

Run: `npx vitest run src/hooks/__tests__/useOverdueAssignments.test.ts src/hooks/__tests__/usePenaltyPolicy.test.ts src/hooks/__tests__/useAppliedPenalties.test.ts --reporter=verbose`
Expected: 15 tests PASS across 3 files

- [ ] **Step 13: Commit**

```bash
git add src/hooks/useOverdueAssignments.ts src/hooks/__tests__/useOverdueAssignments.test.ts
git add src/hooks/usePenaltyPolicy.ts src/hooks/__tests__/usePenaltyPolicy.test.ts
git add src/hooks/useAppliedPenalties.ts src/hooks/__tests__/useAppliedPenalties.test.ts
git commit -m "feat(hooks): add admin penalty hooks — overdue, policy, applied penalties"
```

---

## Task 5: Admin PenaltiesPage

**Files:**
- Create: `src/pages/admin/penalties/PenaltiesPage.tsx`
- Create: `src/pages/admin/penalties/__tests__/PenaltiesPage.test.tsx`

Three sections: policy editor, overdue list (pre-batch waiver), applied penalties list (post-batch reversal). All Hebrew RTL.

- [ ] **Step 1: Write failing test**

```typescript
// src/pages/admin/penalties/__tests__/PenaltiesPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'

const mockWaive = vi.fn().mockResolvedValue({ error: null })
const mockReverse = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn().mockResolvedValue({ error: null })
const mockRefetchOverdue = vi.fn()
const mockRefetchApplied = vi.fn()

vi.mock('../../../../hooks/useOverdueAssignments', () => ({
  useOverdueAssignments: vi.fn(() => ({
    assignments: [],
    loading: false,
    error: null,
    waive: mockWaive,
    refetch: mockRefetchOverdue,
  })),
}))
vi.mock('../../../../hooks/usePenaltyPolicy', () => ({
  usePenaltyPolicy: vi.fn(() => ({
    policy: { overdue_day_deduction: 1, overdue_week_deduction: 5 },
    loading: false,
    error: null,
    update: mockUpdate,
  })),
}))
vi.mock('../../../../hooks/useAppliedPenalties', () => ({
  useAppliedPenalties: vi.fn(() => ({
    penalties: [],
    loading: false,
    error: null,
    reverse: mockReverse,
    refetch: mockRefetchApplied,
  })),
}))

import { useOverdueAssignments } from '../../../../hooks/useOverdueAssignments'
import { usePenaltyPolicy } from '../../../../hooks/usePenaltyPolicy'
import { useAppliedPenalties } from '../../../../hooks/useAppliedPenalties'
import PenaltiesPage from '../PenaltiesPage'

const mockUseOverdue = vi.mocked(useOverdueAssignments)
const mockUsePolicy = vi.mocked(usePenaltyPolicy)
const mockUseApplied = vi.mocked(useAppliedPenalties)

const fakeAssignment = {
  id: 'a1',
  chore_id: 'c1',
  user_id: 'p1',
  calendar_day: 1,
  calendar_slot: 'morning' as const,
  penalty_waived: false,
  chores: { title: 'כלי מטבח', coin_value: 10 },
  profiles: { name: 'דנה', avatar_url: null },
}

const fakePenalty = {
  id: 'pen1',
  chore_assignment_id: 'a1',
  user_id: 'p1',
  coin_deduction: 1,
  reason: 'overdue',
  waived_by: null,
  waived_at: null,
  applied_at: '2026-04-19T23:59:00Z',
  batch_id: 'batch-1',
  chore_assignments: { chore_id: 'c1', chores: { title: 'כלי מטבח' } },
  profiles: { name: 'דנה', avatar_url: null },
}

function renderPage() {
  return render(<MemoryRouter><PenaltiesPage /></MemoryRouter>)
}

describe('PenaltiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePolicy.mockReturnValue({
      policy: { overdue_day_deduction: 1, overdue_week_deduction: 5, id: 'pol1', family_id: 'f1', per_chore_overrides: null, updated_by: null, updated_at: '' },
      loading: false, error: null, update: mockUpdate,
    })
    mockUseOverdue.mockReturnValue({ assignments: [], loading: false, error: null, waive: mockWaive, refetch: mockRefetchOverdue })
    mockUseApplied.mockReturnValue({ penalties: [], loading: false, error: null, reverse: mockReverse, refetch: mockRefetchApplied })
  })

  it('renders page heading', () => {
    renderPage()
    expect(screen.getByText('ניהול הפסדים')).toBeInTheDocument()
  })

  it('shows policy deduction values', () => {
    renderPage()
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('5')).toBeInTheDocument()
  })

  it('shows empty state when no overdue assignments', () => {
    renderPage()
    expect(screen.getByText('אין משימות באיחור')).toBeInTheDocument()
  })

  it('shows overdue assignment with player name and chore title', () => {
    mockUseOverdue.mockReturnValue({ assignments: [fakeAssignment], loading: false, error: null, waive: mockWaive, refetch: mockRefetchOverdue })
    renderPage()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
  })

  it('waive button calls waive with assignment id', async () => {
    mockUseOverdue.mockReturnValue({ assignments: [fakeAssignment], loading: false, error: null, waive: mockWaive, refetch: mockRefetchOverdue })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /ויתור/i }))
    expect(mockWaive).toHaveBeenCalledWith('a1')
  })

  it('shows applied penalties section', () => {
    mockUseApplied.mockReturnValue({ penalties: [fakePenalty], loading: false, error: null, reverse: mockReverse, refetch: mockRefetchApplied })
    renderPage()
    expect(screen.getByText('הפסדים שהוחלו')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /בטל הפסד/i })).toBeInTheDocument()
  })

  it('reverse button calls reverse with penalty id', async () => {
    mockUseApplied.mockReturnValue({ penalties: [fakePenalty], loading: false, error: null, reverse: mockReverse, refetch: mockRefetchApplied })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /בטל הפסד/i }))
    expect(mockReverse).toHaveBeenCalledWith('pen1')
  })

  it('save policy button calls update with new values', async () => {
    renderPage()
    const inputs = screen.getAllByRole('spinbutton')
    await userEvent.clear(inputs[0])
    await userEvent.type(inputs[0], '2')
    await userEvent.click(screen.getByRole('button', { name: /שמור/i }))
    expect(mockUpdate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run src/pages/admin/penalties/__tests__/PenaltiesPage.test.tsx --reporter=verbose`
Expected: FAIL — `Cannot find module '../PenaltiesPage'`

- [ ] **Step 3: Implement `src/pages/admin/penalties/PenaltiesPage.tsx`**

```typescript
import { useState } from 'react'
import { useOverdueAssignments } from '../../../hooks/useOverdueAssignments'
import { usePenaltyPolicy } from '../../../hooks/usePenaltyPolicy'
import { useAppliedPenalties } from '../../../hooks/useAppliedPenalties'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Badge } from '../../../components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'

export default function PenaltiesPage() {
  const { assignments, loading: overdueLoading, waive } = useOverdueAssignments()
  const { policy, update } = usePenaltyPolicy()
  const { penalties, loading: penaltiesLoading, reverse } = useAppliedPenalties()

  const [dayDeduction, setDayDeduction] = useState<string>('')
  const [weekDeduction, setWeekDeduction] = useState<string>('')
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const effectiveDay = dayDeduction !== '' ? Number(dayDeduction) : (policy?.overdue_day_deduction ?? 1)
  const effectiveWeek = weekDeduction !== '' ? Number(weekDeduction) : (policy?.overdue_week_deduction ?? 5)

  async function handleSavePolicy() {
    setPolicyError(null)
    if (effectiveDay <= 0 || effectiveWeek <= 0) {
      setPolicyError('ערכי הקנס חייבים להיות גדולים מאפס')
      return
    }
    const { error } = await update(effectiveDay, effectiveWeek)
    if (error) setPolicyError(error)
  }

  async function handleWaive(assignmentId: string) {
    setActionError(null)
    const { error } = await waive(assignmentId)
    if (error) setActionError(error)
  }

  async function handleReverse(penaltyId: string) {
    setActionError(null)
    const { error } = await reverse(penaltyId)
    if (error) setActionError(error)
  }

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">ניהול הפסדים</h1>

      {actionError && (
        <p className="text-sm text-destructive">{actionError}</p>
      )}

      {/* Policy Editor */}
      <Card>
        <CardHeader>
          <CardTitle>הגדרת קנסות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div className="space-y-1">
              <Label htmlFor="day-deduction">קנס יומי (מטבעות)</Label>
              <Input
                id="day-deduction"
                type="number"
                min={1}
                className="w-24"
                value={dayDeduction !== '' ? dayDeduction : (policy?.overdue_day_deduction ?? 1)}
                onChange={e => setDayDeduction(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="week-deduction">קנס שבועי (מטבעות)</Label>
              <Input
                id="week-deduction"
                type="number"
                min={1}
                className="w-24"
                value={weekDeduction !== '' ? weekDeduction : (policy?.overdue_week_deduction ?? 5)}
                onChange={e => setWeekDeduction(e.target.value)}
              />
            </div>
          </div>
          {policyError && <p className="text-sm text-destructive">{policyError}</p>}
          <Button onClick={handleSavePolicy}>שמור</Button>
        </CardContent>
      </Card>

      {/* Overdue Assignments — Pre-batch waiver */}
      <Card>
        <CardHeader>
          <CardTitle>משימות באיחור — ויתור לפני קנס</CardTitle>
        </CardHeader>
        <CardContent>
          {overdueLoading ? (
            <div role="status" className="text-muted-foreground text-sm">טוען...</div>
          ) : assignments.length === 0 ? (
            <p className="text-muted-foreground text-sm">אין משימות באיחור</p>
          ) : (
            <div className="space-y-2">
              {assignments.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded border p-2">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={a.profiles.avatar_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">{a.profiles.name[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{a.profiles.name}</p>
                      <p className="text-xs text-muted-foreground">{a.chores.title}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleWaive(a.id)}>
                    ויתור על הפסד
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Applied Penalties — Post-batch reversal */}
      <Card>
        <CardHeader>
          <CardTitle>הפסדים שהוחלו</CardTitle>
        </CardHeader>
        <CardContent>
          {penaltiesLoading ? (
            <div role="status" className="text-muted-foreground text-sm">טוען...</div>
          ) : penalties.length === 0 ? (
            <p className="text-muted-foreground text-sm">אין הפסדים שהוחלו</p>
          ) : (
            <div className="space-y-2">
              {penalties.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded border p-2">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={p.profiles.avatar_url ?? undefined} />
                      <AvatarFallback className="text-[10px]">{p.profiles.name[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{p.profiles.name}</p>
                      <p className="text-xs text-muted-foreground">{p.chore_assignments.chores.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.applied_at).toLocaleDateString('he-IL')} — {p.coin_deduction} מטבעות
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.waived_by ? (
                      <Badge variant="secondary">בוטל</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleReverse(p.id)}>
                        בטל הפסד
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run src/pages/admin/penalties/__tests__/PenaltiesPage.test.tsx --reporter=verbose`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/penalties/PenaltiesPage.tsx src/pages/admin/penalties/__tests__/PenaltiesPage.test.tsx
git commit -m "feat(admin): add PenaltiesPage — policy editor, overdue waiver, reversal"
```

---

## Task 6: Router + AdminLayout Nav

**Files:**
- Modify: `src/router.tsx`
- Modify: `src/components/layout/AdminLayout.tsx`

Add `/admin/penalties` route and nav entry.

- [ ] **Step 1: Add route to `src/router.tsx`**

Add import at top (with other admin page imports):
```typescript
import PenaltiesPage from './pages/admin/penalties/PenaltiesPage'
```

Add route inside the `/admin` children array, after the `players` route:
```typescript
{ path: 'penalties', element: <PenaltiesPage /> },
```

- [ ] **Step 2: Add nav item to `src/components/layout/AdminLayout.tsx`**

Add `AlertTriangle` to the lucide-react import:
```typescript
import {
  LayoutDashboard,
  CheckSquare,
  ClipboardCheck,
  Gift,
  ShoppingBag,
  CalendarDays,
  MessageSquare,
  Users,
  AlertTriangle,
} from 'lucide-react'
```

Add to `adminNavItems` array (after the `players` entry):
```typescript
{ to: '/admin/penalties', label: 'הפסדים', icon: AlertTriangle },
```

- [ ] **Step 3: Verify app builds**

Run: `npm run build`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/router.tsx src/components/layout/AdminLayout.tsx
git commit -m "feat(nav): add /admin/penalties route and nav item"
```

---

## Task 7: Player Dashboard Penalty History

**Files:**
- Modify: `src/pages/player/PlayerDashboard.tsx`
- Modify: `src/pages/player/__tests__/PlayerDashboard.test.tsx`

Adds a "היסטוריית הפסדים" section at the bottom of the player dashboard. Only renders if at least one penalty exists.

- [ ] **Step 1: Write failing tests**

Add to the existing `describe('PlayerDashboard', ...)` block in `src/pages/player/__tests__/PlayerDashboard.test.tsx`.

First, add the mock at the top of the file (with the other vi.mock calls):
```typescript
vi.mock('../../../hooks/usePenalties', () => ({
  usePenalties: vi.fn(() => ({ penalties: [], loading: false, error: null })),
}))
```

Add import after the other hook imports:
```typescript
import { usePenalties } from '../../../hooks/usePenalties'
const mockUsePenalties = vi.mocked(usePenalties)
```

Also add to `beforeEach`:
```typescript
mockUsePenalties.mockReturnValue({ penalties: [], loading: false, error: null })
```

Add these two test cases:
```typescript
it('does not render penalty section when no penalties', () => {
  mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
  mockUsePenalties.mockReturnValue({ penalties: [], loading: false, error: null })
  renderDashboard()
  expect(screen.queryByText('היסטוריית הפסדים')).not.toBeInTheDocument()
})

it('renders penalty history section when penalties exist', () => {
  mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
  mockUsePenalties.mockReturnValue({
    penalties: [{
      id: 'pen1',
      chore_assignment_id: 'a1',
      user_id: 'p1',
      coin_deduction: 1,
      reason: 'overdue',
      waived_by: null,
      waived_at: null,
      applied_at: '2026-04-19T23:59:00Z',
      batch_id: null,
      chore_assignments: { chore_id: 'c1', chores: { title: 'כלי מטבח' } },
    }],
    loading: false,
    error: null,
  })
  renderDashboard()
  expect(screen.getByText('היסטוריית הפסדים')).toBeInTheDocument()
  expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test — verify new tests fail**

Run: `npx vitest run src/pages/player/__tests__/PlayerDashboard.test.tsx --reporter=verbose`
Expected: 2 new tests FAIL (existing tests still pass)

- [ ] **Step 3: Modify `src/pages/player/PlayerDashboard.tsx`**

Add import after the other hook imports:
```typescript
import { usePenalties } from '../../hooks/usePenalties'
```

Add hook call inside `PlayerDashboard` function, after the existing hooks:
```typescript
const { penalties } = usePenalties()
```

Add penalty history section at the bottom of the returned JSX, just before the closing `</div>`:
```typescript
{penalties.length > 0 && (
  <div className="space-y-2">
    <h2 className="text-lg font-semibold">היסטוריית הפסדים</h2>
    {penalties.map(p => (
      <Card key={p.id}>
        <CardContent className="py-3 flex items-center justify-between">
          <div>
            <p className="font-medium">{p.chore_assignments.chores.title}</p>
            <p className="text-sm text-muted-foreground">
              {new Date(p.applied_at).toLocaleDateString('he-IL')} — {p.coin_deduction} מטבעות
            </p>
          </div>
          {p.waived_by ? (
            <Badge variant="secondary">בוטל</Badge>
          ) : (
            <Badge variant="destructive">{p.coin_deduction} הופחת</Badge>
          )}
        </CardContent>
      </Card>
    ))}
  </div>
)}
```

- [ ] **Step 4: Run test — verify all pass**

Run: `npx vitest run src/pages/player/__tests__/PlayerDashboard.test.tsx --reporter=verbose`
Expected: all tests PASS (including the 2 new ones)

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: all tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/pages/player/PlayerDashboard.tsx src/pages/player/__tests__/PlayerDashboard.test.tsx
git commit -m "feat(player): add penalty history section to PlayerDashboard"
```
