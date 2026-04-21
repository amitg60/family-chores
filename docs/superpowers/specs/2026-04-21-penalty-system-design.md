# Penalty System Design

**Goal:** Automatically detect overdue assignments, apply coin deductions at week-end via pg_cron, allow admin pre-batch waiver and post-batch reversal, and show penalty history to players.

**Architecture:** Pure SQL + pg_cron. `apply_weekly_penalties()` is a SECURITY DEFINER function called by pg_cron Saturday 23:59. All privileged writes go through SECURITY DEFINER RPCs — no client-supplied data trusted for authorization. Admin waiver (pre-batch) and reversal (post-batch) are separate admin-only RPCs.

**Tech Stack:** PostgreSQL (SECURITY DEFINER functions, pg_cron, REVOKE on internal helpers), Supabase, React + TypeScript.

---

## Terminology

- DB/code: `penalty` / `penalties` (existing table name, unchanged)
- UI Hebrew: `הפסד` / `הפסדים` (not `קנסות`)

---

## Penalty Policy

Defaults stored in `penalty_policy` table (one row per family):

| Field | Default | Meaning |
|-------|---------|---------|
| `overdue_day_deduction` | 1 | Coins deducted for overdue assignment with a scheduled calendar day/slot |
| `overdue_week_deduction` | 5 | Coins deducted for overdue assignment without a scheduled slot |

Admin can update via `update_penalty_policy()` RPC. Per-chore overrides (`per_chore_overrides` JSONB column) are out of scope for this feature.

---

## Overdue Detection

Automatic — no manual marking needed. An assignment is eligible for penalty when:
- `status = 'overdue'`
- `penalty_waived = false` (new column on `chore_assignments`)
- No existing penalty row for this assignment (`NOT EXISTS` guard)

Week boundary detection is handled by pg_cron schedule, not by the function itself.

---

## Coin Deduction Rule

```
deduction = overdue_day_deduction  if calendar_day IS NOT NULL
            overdue_week_deduction  otherwise
```

Coins floored at zero: `GREATEST(0, coins - deduction)`. Negative balances are not allowed.

---

## Database Changes

### Migration: `chore_assignments`

```sql
ALTER TABLE chore_assignments
  ADD COLUMN penalty_waived boolean NOT NULL DEFAULT false;
```

### Migration: `penalties` — confirm columns + add `batch_id`

`waived_by` and `waived_at` are confirmed in the existing schema. Add `batch_id` for audit:

```sql
-- waived_by uuid REFERENCES profiles(id) — already exists
-- waived_at timestamptz                  — already exists
-- applied_at timestamptz DEFAULT now()   — already exists

ALTER TABLE penalties
  ADD COLUMN IF NOT EXISTS batch_id uuid;
```

`batch_id` groups all penalty rows from a single `apply_weekly_penalties()` run, enabling audit queries like "show everything deducted in run X".

### Migration: `penalty_policy` defaults

```sql
ALTER TABLE penalty_policy
  ALTER COLUMN overdue_day_deduction SET DEFAULT 1,
  ALTER COLUMN overdue_week_deduction SET DEFAULT 5;

-- Seed default rows for existing families that have no policy row yet.
-- apply_weekly_penalties iterates penalty_policy, so families without a row are skipped.
INSERT INTO penalty_policy (family_id, overdue_day_deduction, overdue_week_deduction)
SELECT id, 1, 5
FROM families
WHERE id NOT IN (SELECT family_id FROM penalty_policy WHERE family_id IS NOT NULL)
ON CONFLICT DO NOTHING;
```

### New internal function: `apply_weekly_penalties()`

SECURITY DEFINER; runs as postgres owner. REVOKE'd from all client roles — only pg_cron (postgres) can call it.

`FOR UPDATE` on `penalty_policy` acquires a row-level lock per family for the duration of the function. This prevents a second overlapping pg_cron invocation (e.g., from a manual trigger or clock drift) from double-processing the same family's overdue assignments concurrently.

```sql
CREATE OR REPLACE FUNCTION apply_weekly_penalties()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r            RECORD;
  v_policy     penalty_policy%ROWTYPE;
  v_deduction  integer;
  v_batch_id   uuid := gen_random_uuid();  -- shared across all rows in this run
  v_user_family uuid;
BEGIN
  -- FOR UPDATE: prevents overlapping pg_cron runs from double-deducting.
  -- Each family's row is locked until this transaction commits.
  FOR v_policy IN SELECT * FROM penalty_policy FOR UPDATE LOOP
    FOR r IN
      SELECT
        ca.id           AS assignment_id,
        ca.user_id,
        ca.chore_id,
        ca.calendar_day
      FROM chore_assignments ca
      WHERE ca.status = 'overdue'
        AND ca.penalty_waived = false
        AND ca.archived = false
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
      -- Family-scope safety check: verify the assignment user belongs to this family.
      -- Defends against cross-family deduction if join logic above ever has a bug.
      SELECT family_id INTO v_user_family FROM profiles WHERE id = r.user_id;
      IF v_user_family IS DISTINCT FROM v_policy.family_id THEN
        RAISE LOG 'apply_weekly_penalties: skipping assignment % — user % family % does not match policy family %',
          r.assignment_id, r.user_id, v_user_family, v_policy.family_id;
        CONTINUE;
      END IF;

      v_deduction := CASE
        WHEN r.calendar_day IS NOT NULL THEN v_policy.overdue_day_deduction
        ELSE v_policy.overdue_week_deduction
      END;

      -- Deduct coins (floor at zero)
      UPDATE profiles
      SET coins      = GREATEST(0, coins - v_deduction),
          updated_at = now()
      WHERE id = r.user_id;

      -- Insert penalty row (notification fires via trg_notify_penalty_applied)
      INSERT INTO penalties (chore_assignment_id, user_id, coin_deduction, reason, batch_id)
      VALUES (r.assignment_id, r.user_id, v_deduction, 'overdue', v_batch_id);
    END LOOP;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_weekly_penalties() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION apply_weekly_penalties() FROM authenticated;
REVOKE EXECUTE ON FUNCTION apply_weekly_penalties() FROM anon;
```

### New RPC: `waive_assignment_penalty(p_assignment_id uuid)`

Admin-only. Sets `penalty_waived = true` before batch runs. Validates caller is admin in same family as the assignment.

```sql
CREATE OR REPLACE FUNCTION waive_assignment_penalty(p_assignment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment chore_assignments%ROWTYPE;
  v_chore      chores%ROWTYPE;
  v_admin_family uuid;
BEGIN
  -- Guard: must be admin
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Not authorized: admin only';
  END IF;

  -- Fetch assignment
  SELECT * INTO v_assignment FROM chore_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  -- Fetch chore to get family_id
  SELECT * INTO v_chore FROM chores WHERE id = v_assignment.chore_id;

  -- Caller must be in same family
  SELECT family_id INTO v_admin_family FROM profiles WHERE id = auth.uid();
  IF v_admin_family IS NULL OR v_admin_family <> v_chore.family_id THEN
    RAISE EXCEPTION 'Not authorized: not in same family';
  END IF;

  -- Mark waived
  UPDATE chore_assignments
  SET penalty_waived = true
  WHERE id = p_assignment_id;
END;
$$;
```

### New RPC: `reverse_penalty(p_penalty_id uuid)`

Admin-only. Restores coins to the penalized player and marks penalty as waived. Can be called after batch has run.

```sql
CREATE OR REPLACE FUNCTION reverse_penalty(p_penalty_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_penalty    penalties%ROWTYPE;
  v_admin_family uuid;
  v_user_family  uuid;
BEGIN
  -- Guard: must be admin
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Not authorized: admin only';
  END IF;

  -- Fetch penalty
  SELECT * INTO v_penalty FROM penalties WHERE id = p_penalty_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Penalty not found';
  END IF;

  -- Already reversed
  IF v_penalty.waived_by IS NOT NULL THEN
    RAISE EXCEPTION 'Penalty already reversed';
  END IF;

  -- Same-family check
  SELECT family_id INTO v_admin_family FROM profiles WHERE id = auth.uid();
  SELECT family_id INTO v_user_family  FROM profiles WHERE id = v_penalty.user_id;
  IF v_admin_family IS NULL OR v_admin_family <> v_user_family THEN
    RAISE EXCEPTION 'Not authorized: not in same family';
  END IF;

  -- Restore coins
  UPDATE profiles
  SET coins      = coins + v_penalty.coin_deduction,
      updated_at = now()
  WHERE id = v_penalty.user_id;

  -- Mark reversed
  UPDATE penalties
  SET waived_by = auth.uid(),
      waived_at = now()
  WHERE id = p_penalty_id;
END;
$$;
```

**Note on coin ceiling:** `profiles.coins` has no upper-bound constraint in the schema. Restoring coins via `coins + coin_deduction` is unconditionally safe — no cap can cause a reversal to silently fail or truncate.

### New RPC: `update_penalty_policy(p_day_deduction int, p_week_deduction int)`

Admin-only. UPSERTs policy row for caller's family.

```sql
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
```

### pg_cron schedule

```sql
SELECT cron.schedule(
  'weekly-penalties',
  '59 23 * * 6',
  'SELECT apply_weekly_penalties()'
);
```

### pg_cron Monitoring

pg_cron writes run history to `cron.job_run_details`. Admins or an on-call process can check:

```sql
SELECT jobid, runid, job_pid, database, username,
       command, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'weekly-penalties')
ORDER BY start_time DESC
LIMIT 10;
```

- `status = 'succeeded'` = normal run
- `status = 'failed'` + `return_message` = error details
- No row for expected Saturday = job did not fire (pg_cron service issue)

Supabase does not expose built-in alerting for pg_cron failures. For now, monitoring is manual (periodic review of `cron.job_run_details`). Future improvement: add a lightweight health-check Edge Function that queries this table and sends a notification if the last Saturday run is missing or failed.

### Batch Processing Scalability Note

`apply_weekly_penalties()` does a sequential per-family, per-assignment loop. For a family chore app with O(10) families and O(100) overdue assignments per run, this is acceptable. If load grows significantly, the inner loop can be replaced with a single set-based `INSERT ... SELECT` + `UPDATE ... FROM` pattern, eliminating the cursor overhead. No change needed now — document as a known optimization path.

---

## TypeScript Changes

### `src/types/database.ts`

No enum changes needed — `penalty_applied` notification type already exists.

Add typed return shapes for new RPCs:

```ts
// Penalty row with chore title (for display)
export interface PenaltyWithChore {
  id: string
  chore_assignment_id: string
  user_id: string
  coin_deduction: number
  reason: string
  waived_by: string | null
  waived_at: string | null
  applied_at: string
  chore_assignments: {
    chore_id: string
    chores: { title: string }
  }
}
```

---

## UI Changes

### Admin: `src/pages/admin/penalties/PenaltiesPage.tsx` (new)

New admin page with three sections:

**1. Penalty Policy Card**
- Fetches current `penalty_policy` row for family
- Inline number inputs: "קנס יומי (מטבעות)", "קנס שבועי (מטבעות)"
- Save button → calls `update_penalty_policy()` RPC

**2. Overdue Assignments — Pre-batch waiver**
- Fetches assignments with `status = 'overdue'` and `penalty_waived = false`
- Table columns: player, chore title, day/slot, coins at risk
- "ויתור על הפסד" button per row → `waive_assignment_penalty()`
- Waived rows refresh out of list on success

**3. Applied Penalties — Post-batch reversal**
- Fetches `penalties` rows for family (joined to profiles + chore_assignments + chores)
- Table columns: player, chore title, date, coins deducted, status
- Reversed penalties show "בוטל" badge (waived_by IS NOT NULL)
- "בטל הפסד" button on non-reversed rows → `reverse_penalty()`

Page is admin-only, gated by existing `isAdmin` check in router.

Add route in `src/App.tsx`:
```tsx
<Route path="/admin/penalties" element={<PenaltiesPage />} />
```

Add nav link in admin sidebar/nav.

### Player: `src/pages/player/dashboard/PlayerDashboard.tsx`

New "היסטוריית הפסדים" section at bottom:

- Fetches own penalties via Supabase query: `penalties` table, `user_id = auth.uid()`, joined to `chore_assignments` → `chores(title)`
- Only renders if `penalties.length > 0`
- List: chore title, date, coins lost
- Reversed penalty: struck-through amount + "בוטל" badge
- Empty state: renders nothing (section hidden)

---

## Security Summary

| Concern | Mitigation |
|---------|-----------|
| Client calling `apply_weekly_penalties` directly | `REVOKE EXECUTE` from PUBLIC/authenticated/anon — unreachable from frontend |
| Admin waiving penalty for another family | Explicit same-family check in `waive_assignment_penalty` and `reverse_penalty` |
| Non-admin calling waiver/reversal RPCs | `is_admin()` guard raises exception before any write |
| Double-reversal of penalty | `waived_by IS NOT NULL` guard raises exception |
| Negative coin balance | `GREATEST(0, coins - deduction)` floor in `apply_weekly_penalties` |
| Double-penalty on same assignment | `NOT EXISTS (SELECT 1 FROM penalties WHERE chore_assignment_id = ca.id)` guard |
| Client reading other players' penalties | RLS on `penalties` allows only own rows to authenticated user |
| Policy update with invalid values | `p_day_deduction <= 0 OR p_week_deduction <= 0` raises exception |
| Admin with no family calling policy update | `family_id IS NULL` guard raises exception |
| Cross-family penalty application in batch | `EXISTS (chores WHERE family_id = v_policy.family_id)` scopes each family's batch; secondary `profiles.family_id = v_policy.family_id` check on `r.user_id` inside the loop as defense-in-depth |
| Overlapping pg_cron runs double-deducting | `FOR UPDATE` on `penalty_policy` locks family row — concurrent invocation blocks until first transaction commits; `NOT EXISTS` guard prevents double-penalty regardless |
| Audit — which penalties came from which run | `batch_id uuid` column on `penalties` groups all rows from a single `apply_weekly_penalties()` call |
| `waived_by` / `waived_at` assumed to exist | Confirmed in existing schema; migration adds `batch_id` only, with explicit comment confirming existing columns |
