# Trust Level Advancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-advance or demote a player's trust level (1–5) based on their approval rate over the last 10 reviewed completions, while keeping admin manual override; add a trust label on the profile page and an approval-rate card for level 3+ players.

**Architecture:** One DB migration adds a new internal `recalculate_trust_level` SQL function (REVOKE'd from clients) and updates `approve_completion`/`reject_completion` to call it after each review. A new `get_my_approval_rate()` RPC is exposed to the frontend. A new `useApprovalRate` hook and an inline `ApprovalRateCard` component surface the data on the player's profile page.

**Tech Stack:** PostgreSQL 15 (SECURITY DEFINER, ALTER TYPE, REVOKE), Supabase CLI (`supabase db push`), React 18 + TypeScript, Vitest + React Testing Library.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/025_trust_level_advancement.sql` | Create | All DB changes: enum extension, recalculate_trust_level, approve_completion, reject_completion, get_my_approval_rate |
| `src/types/database.ts` | Modify | Add `'trust_level_changed'` to `NotificationType` union |
| `src/hooks/useApprovalRate.ts` | Create | Calls `get_my_approval_rate()` RPC; returns stats + loading/error |
| `src/hooks/__tests__/useApprovalRate.test.ts` | Create | Unit tests for the new hook |
| `src/pages/player/profile/ProfilePage.tsx` | Modify | Trust label, conditional `ApprovalRateCard` component for level 3+ |
| `src/pages/player/profile/__tests__/ProfilePage.test.tsx` | Modify | Tests for trust label and approval-rate card |

---

## Task 1: DB migration

**Files:**
- Create: `supabase/migrations/025_trust_level_advancement.sql`

This migration has no automated test — verification is done via the Supabase SQL editor after `supabase db push`. The steps below include exact verification queries.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/025_trust_level_advancement.sql` with this exact content:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend notification_type enum
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trust_level_changed';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Internal helper: recalculate_trust_level
--    Called by approve_completion and reject_completion only.
--    EXECUTE is revoked from all client roles.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recalculate_trust_level(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved   integer;
  v_total      integer;
  v_level      integer;
  v_new_level  integer;
  v_family_id  uuid;
BEGIN
  -- Guard: profile must exist; silently exit if not
  SELECT trust_level, family_id INTO v_level, v_family_id
  FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Count the last 10 reviewed (approved or rejected) completions
  SELECT
    COUNT(*) FILTER (WHERE status = 'approved'),
    COUNT(*)
  INTO v_approved, v_total
  FROM (
    SELECT cc.status
    FROM chore_completions cc
    WHERE cc.completed_by = p_user_id
      AND cc.status IN ('approved', 'rejected')
    ORDER BY cc.completed_at DESC
    LIMIT 10
  ) sub;

  -- Not enough reviewed completions → no automatic change
  IF v_total < 10 THEN
    RETURN;
  END IF;

  -- approved_count >= 9 out of 10 → promote  (≥90%; boundary included)
  -- approved_count < 7  out of 10 → demote   (<70%; boundary excluded → 70% = no change)
  IF v_approved >= 9 AND v_level < 5 THEN
    v_new_level := v_level + 1;
  ELSIF v_approved < 7 AND v_level > 1 THEN
    v_new_level := v_level - 1;
  ELSE
    RETURN;
  END IF;

  UPDATE profiles
  SET trust_level = v_new_level, updated_at = now()
  WHERE id = p_user_id;

  -- Notification insert runs as the postgres owner (SECURITY DEFINER), bypassing RLS.
  -- This is intentional and consistent with all other server-side notification inserts.
  INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
  VALUES (
    p_user_id,
    v_family_id,
    'trust_level_changed',
    CASE WHEN v_new_level > v_level THEN 'עלית ברמת האמון!' ELSE 'רמת האמון ירדה' END,
    CASE WHEN v_new_level > v_level
      THEN 'ההורים מעריכים את התייחסותך למטלות ולכן, עלית דרגה ברמת האמון'
      ELSE 'נראה כי לא התייחסת ברצינות במשימות, הפעם דרגת האמון ירדה, אנחנו יודעים שבפעם הבאה תצליח/י'
    END,
    NULL
  );
END;
$$;

-- Prevent any client role from calling this directly
REVOKE EXECUTE ON FUNCTION recalculate_trust_level(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recalculate_trust_level(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION recalculate_trust_level(uuid) FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Replace approve_completion
--    Adds four flat authorization rules and calls recalculate_trust_level.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_completion(completion_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completion    chore_completions%ROWTYPE;
  v_assignment    chore_assignments%ROWTYPE;
  v_chore         chores%ROWTYPE;
  v_caller_family uuid;
  v_caller_trust  integer;
BEGIN
  SELECT * INTO v_completion FROM chore_completions WHERE id = completion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completion not found';
  END IF;
  IF v_completion.status <> 'pending' THEN
    RAISE EXCEPTION 'Completion is not pending';
  END IF;

  SELECT * INTO v_assignment FROM chore_assignments WHERE id = v_completion.chore_assignment_id;
  SELECT * INTO v_chore      FROM chores             WHERE id = v_assignment.chore_id;

  IF NOT is_admin() THEN
    -- Rule 1: caller must have a profile
    SELECT family_id, trust_level INTO v_caller_family, v_caller_trust
    FROM profiles WHERE id = auth.uid();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not authorized: caller has no profile';
    END IF;

    -- Rule 2: trust level must be at least 4 (levels 1–3 cannot approve)
    IF COALESCE(v_caller_trust, 1) < 4 THEN
      RAISE EXCEPTION 'Not authorized: trust level too low to approve completions';
    END IF;

    -- Rule 3: caller must be in the same family as the chore
    IF v_caller_family IS NULL OR v_caller_family <> v_chore.family_id THEN
      RAISE EXCEPTION 'Not authorized: approver is not in the same family as this chore';
    END IF;

    -- Rule 4: trust level 4 may only self-approve; level 5 may approve any family member
    IF v_caller_trust = 4 AND v_completion.completed_by <> auth.uid() THEN
      RAISE EXCEPTION 'Not authorized: trust level 4 may only approve own completions';
    END IF;
    -- (level >= 5 and rules 1–3 passed → no further restriction)
  END IF;

  UPDATE chore_completions
    SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = completion_id;

  UPDATE chore_assignments SET status = 'completed' WHERE id = v_assignment.id;

  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
    VALUES (v_completion.completed_by, v_chore.family_id, v_chore.coin_value, 'chore_completed', completion_id);

  UPDATE profiles
    SET coin_balance = coin_balance + v_chore.coin_value
    WHERE id = v_completion.completed_by;

  PERFORM recalculate_trust_level(v_completion.completed_by);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Replace reject_completion
--    Adds recalculate_trust_level call after rejection. Remains admin-only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_completion(completion_id UUID, reason TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completion chore_completions%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can reject completions';
  END IF;

  SELECT * INTO v_completion FROM chore_completions WHERE id = completion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completion not found';
  END IF;

  UPDATE chore_completions
    SET status     = 'rejected',
        rejection_reason = reason,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = completion_id;

  UPDATE chore_assignments
    SET status = 'pending'
    WHERE id = v_completion.chore_assignment_id;

  PERFORM recalculate_trust_level(v_completion.completed_by);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. New RPC: get_my_approval_rate
--    Returns all-time approval stats for the calling player (display only).
--    Uses auth.uid() internally — players can only fetch their own data.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_approval_rate()
RETURNS TABLE(approved integer, rejected integer, total integer, rate numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: unauthenticated callers get an empty result set, not an error
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  -- Guard: profile must exist
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE cc.status = 'approved')::integer  AS approved,
    COUNT(*) FILTER (WHERE cc.status = 'rejected')::integer  AS rejected,
    COUNT(*)::integer                                         AS total,
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE ROUND(
           COUNT(*) FILTER (WHERE cc.status = 'approved')::numeric / COUNT(*) * 100,
           1
         )
    END                                                       AS rate
  FROM chore_completions cc
  WHERE cc.completed_by = auth.uid()
    AND cc.status IN ('approved', 'rejected');
END;
$$;
```

- [ ] **Step 2: Push migration to Supabase**

```bash
supabase db push
```

Expected: migration `025_trust_level_advancement` applied successfully. No errors.

- [ ] **Step 3: Verify enum extension in SQL editor**

Run in Supabase SQL editor:

```sql
SELECT enumlabel FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'notification_type'
ORDER BY enumsortorder;
```

Expected: `trust_level_changed` appears in the list.

- [ ] **Step 4: Verify recalculate_trust_level is REVOKE'd**

Run in Supabase SQL editor:

```sql
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name = 'recalculate_trust_level';
```

Expected: no rows for `authenticated`, `anon`, or `public`. Only `postgres` (the owner) should appear.

- [ ] **Step 5: Verify get_my_approval_rate is callable**

In the SQL editor, as an authenticated user (or use the Supabase test JWT), call:

```sql
SELECT * FROM get_my_approval_rate();
```

Expected: returns one row with `approved`, `rejected`, `total`, `rate` columns (values may be 0/null for a fresh test user).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/025_trust_level_advancement.sql
git commit -m "feat: add trust level auto-recalculation DB migration"
```

---

## Task 2: TypeScript type update

**Files:**
- Modify: `src/types/database.ts:14-18`

- [ ] **Step 1: Add `trust_level_changed` to `NotificationType`**

In `src/types/database.ts`, the `NotificationType` union is on lines 14–18. Add the new value:

```typescript
export type NotificationType =
  | 'chore_assigned' | 'completion_reviewed' | 'trade_received' | 'trade_resolved'
  | 'redemption_resolved' | 'proposal_resolved' | 'penalty_applied' | 'achievement_earned'
  | 'reminder' | 'alias_vote_requested' | 'alias_vote_resolved' | 'chore_deleted'
  | 'trust_level_changed'
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add trust_level_changed notification type"
```

---

## Task 3: `useApprovalRate` hook (TDD)

**Files:**
- Create: `src/hooks/useApprovalRate.ts`
- Create: `src/hooks/__tests__/useApprovalRate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/__tests__/useApprovalRate.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockRpc } from '../../test/mocks/supabase'
import { useApprovalRate } from '../useApprovalRate'

describe('useApprovalRate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockRpc.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useApprovalRate())
    expect(result.current.loading).toBe(true)
    expect(result.current.approved).toBe(0)
    expect(result.current.total).toBe(0)
    expect(result.current.rate).toBeNull()
  })

  it('returns approval stats on success', async () => {
    mockRpc.mockResolvedValue({
      data: [{ approved: 9, rejected: 1, total: 10, rate: 90.0 }],
      error: null,
    })
    const { result } = renderHook(() => useApprovalRate())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.approved).toBe(9)
    expect(result.current.rejected).toBe(1)
    expect(result.current.total).toBe(10)
    expect(result.current.rate).toBe(90.0)
    expect(result.current.error).toBeNull()
  })

  it('returns null rate and zero counts when no completions exist', async () => {
    mockRpc.mockResolvedValue({
      data: [{ approved: 0, rejected: 0, total: 0, rate: null }],
      error: null,
    })
    const { result } = renderHook(() => useApprovalRate())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.total).toBe(0)
    expect(result.current.rate).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('handles empty data array gracefully', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => useApprovalRate())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.approved).toBe(0)
    expect(result.current.total).toBe(0)
    expect(result.current.rate).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('sets error when RPC fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const { result } = renderHook(() => useApprovalRate())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
    expect(result.current.total).toBe(0)
  })

  it('calls get_my_approval_rate RPC', async () => {
    mockRpc.mockResolvedValue({
      data: [{ approved: 5, rejected: 0, total: 5, rate: 100.0 }],
      error: null,
    })
    renderHook(() => useApprovalRate())
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('get_my_approval_rate'))
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- useApprovalRate --run
```

Expected: FAIL — `Cannot find module '../useApprovalRate'`

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useApprovalRate.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

export interface ApprovalRateResult {
  approved: number
  rejected: number
  total: number
  rate: number | null
  loading: boolean
  error: string | null
}

export function useApprovalRate(): ApprovalRateResult {
  const [approved, setApproved] = useState(0)
  const [rejected, setRejected] = useState(0)
  const [total, setTotal] = useState(0)
  const [rate, setRate] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchRate = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('get_my_approval_rate')
    if (!mountedRef.current) return
    if (rpcError) {
      setError(rpcError.message)
    } else {
      const row = (data as { approved: number; rejected: number; total: number; rate: number | null }[] | null)?.[0]
      setApproved(row?.approved ?? 0)
      setRejected(row?.rejected ?? 0)
      setTotal(row?.total ?? 0)
      setRate(row?.rate ?? null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchRate() }, [fetchRate])

  return { approved, rejected, total, rate, loading, error }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- useApprovalRate --run
```

Expected: PASS — 6 tests passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useApprovalRate.ts src/hooks/__tests__/useApprovalRate.test.ts
git commit -m "feat: add useApprovalRate hook"
```

---

## Task 4: ProfilePage UI (TDD)

**Files:**
- Modify: `src/pages/player/profile/ProfilePage.tsx`
- Modify: `src/pages/player/profile/__tests__/ProfilePage.test.tsx`

**Context:** The existing auth mock has `trust_level: 3`. At level 3, the trust label is "אמין" and the approval rate card should be visible. The existing tests must keep passing.

- [ ] **Step 1: Write failing tests**

Add a `vi.mock` for `useApprovalRate` and two new test cases to `src/pages/player/profile/__tests__/ProfilePage.test.tsx`. Insert these additions — do not remove any existing content.

Add this mock near the top of the file, after the existing `vi.mock` blocks:

```typescript
vi.mock('../../../../hooks/useApprovalRate', () => ({
  useApprovalRate: vi.fn(() => ({
    approved: 8,
    rejected: 2,
    total: 10,
    rate: 80.0,
    loading: false,
    error: null,
  })),
}))
```

Add these two test cases inside the existing `describe('ProfilePage', ...)` block:

```typescript
  it('shows trust level label for the current level', () => {
    renderPage()
    // trust_level is 3 → label is 'אמין'
    expect(screen.getByText(/אמין/)).toBeInTheDocument()
  })

  it('shows approval rate card when trust_level is 3 or higher', () => {
    renderPage()
    // trust_level is 3 in the auth mock → card should render
    expect(screen.getByText(/אחוז אישורים/)).toBeInTheDocument()
    expect(screen.getByText(/80/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to confirm the two new ones fail**

```bash
npm test -- ProfilePage --run
```

Expected: existing 6 tests PASS, new 2 tests FAIL — `אמין` and `אחוז אישורים` not found.

- [ ] **Step 3: Implement ProfilePage changes**

In `src/pages/player/profile/ProfilePage.tsx`, make these three changes:

**Change 1** — add import for `useApprovalRate` after the existing hook imports:

```typescript
import { useApprovalRate } from '../../../hooks/useApprovalRate'
```

**Change 2** — add the `TRUST_LABELS` constant and the `ApprovalRateCard` component before the `ProfilePage` function definition:

```typescript
const TRUST_LABELS = ['', 'מתחיל', 'מתקדם', 'אמין', 'בכיר', 'אלוף/פה']

function ApprovalRateCard() {
  const { approved, total, rate, loading, error } = useApprovalRate()
  if (loading) return <div className="text-xs text-muted-foreground">טוען...</div>
  if (error) return null
  return (
    <Card>
      <CardContent className="py-3 text-center space-y-1">
        <p className="text-xs text-muted-foreground">אחוז אישורים</p>
        <p className="text-2xl font-bold">{rate !== null ? `${rate}%` : '—'}</p>
        <p className="text-xs text-muted-foreground">{approved} אושרו מתוך {total}</p>
      </CardContent>
    </Card>
  )
}
```

**Change 3** — update the trust level display section. Find this block in `ProfilePage`:

```typescript
        <div className="w-full max-w-xs space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>רמת אמון</span>
            <span>{profile?.trust_level ?? 0} / 5</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${((profile?.trust_level ?? 0) / 5) * 100}%` }}
            />
          </div>
        </div>
```

Replace it with:

```typescript
        <div className="w-full max-w-xs space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>רמת אמון: {TRUST_LABELS[profile?.trust_level ?? 0]}</span>
            <span>{profile?.trust_level ?? 0} / 5</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${((profile?.trust_level ?? 0) / 5) * 100}%` }}
            />
          </div>
          {(profile?.trust_level ?? 0) >= 3 && <ApprovalRateCard />}
        </div>
```

- [ ] **Step 4: Run all tests to confirm all pass**

```bash
npm test -- ProfilePage --run
```

Expected: PASS — 8 tests passing, 0 failing (6 existing + 2 new).

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
npm test --run
```

Expected: all tests pass. If `useApprovalRate` is imported by ProfilePage but not mocked in another test file that renders ProfilePage, that test will fail — add the same `vi.mock('../../../../hooks/useApprovalRate', ...)` block to that test file.

- [ ] **Step 6: Commit**

```bash
git add src/pages/player/profile/ProfilePage.tsx src/pages/player/profile/__tests__/ProfilePage.test.tsx
git commit -m "feat: add trust level label and approval rate card to ProfilePage"
```

---

## Self-Review

**Spec coverage:**
- ✅ `trust_level_changed` enum value — Task 1 (SQL) + Task 2 (TypeScript)
- ✅ `recalculate_trust_level` internal function with profile guard, 10-review window, thresholds, notification — Task 1
- ✅ REVOKE from all client roles — Task 1
- ✅ `approve_completion` four flat rules + `PERFORM recalculate_trust_level` — Task 1
- ✅ `reject_completion` + `PERFORM recalculate_trust_level` — Task 1
- ✅ `get_my_approval_rate()` with auth.uid() guard and profile existence guard — Task 1
- ✅ `useApprovalRate` hook — Task 3
- ✅ Trust level labels (מתחיל/מתקדם/אמין/בכיר/אלוף/פה) — Task 4
- ✅ Approval rate card gated at trust_level ≥ 3 — Task 4
- ✅ Admin PlayersPage — no changes needed (existing +/− buttons stay)

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:** `ApprovalRateResult` defined in `useApprovalRate.ts` and imported in `ProfilePage.tsx` via the `useApprovalRate` hook. The `TRUST_LABELS` array index matches the 1–5 trust level values from `profiles.trust_level`.
