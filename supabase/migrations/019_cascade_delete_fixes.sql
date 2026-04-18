-- ============================================================
-- Fix 1: Add is_admin() guard as the very first check.
-- Fix 2: Replace direct INSERT into notifications (blocked by RLS
--         when SECURITY INVOKER) with calls to the SECURITY DEFINER
--         insert_notification() helper defined in migration 012.
--         Achieved by replacing the CTE with a loop.
-- ============================================================
CREATE OR REPLACE FUNCTION delete_chore(p_chore_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_caller_family_id uuid;
  v_chore_family_id  uuid;
  v_chore_status     chore_status;
  v_assignment       RECORD;
BEGIN
  -- Fix 1: Admin-only guard — must come before any side-effecting work.
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Step 1: Strict, null-safe family-scope authorization
  SELECT family_id INTO v_caller_family_id
  FROM profiles
  WHERE id = auth.uid();

  SELECT family_id, status INTO v_chore_family_id, v_chore_status
  FROM chores
  WHERE id = p_chore_id;

  IF v_caller_family_id IS NULL
     OR v_chore_family_id IS NULL
     OR v_caller_family_id <> v_chore_family_id THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Step 2: Status validation
  -- Already deleted: idempotent no-op, return immediately, no error.
  IF v_chore_status = 'deleted' THEN
    RETURN;
  END IF;
  -- Archived or pending_approval: not deletable.
  IF v_chore_status IN ('archived', 'pending_approval') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  -- Step 3: Pending completion check (server-side enforcement)
  IF EXISTS (
    SELECT 1
    FROM chore_completions cc
    JOIN chore_assignments ca ON cc.chore_assignment_id = ca.id
    WHERE ca.chore_id = p_chore_id
      AND cc.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'PENDING_COMPLETIONS';
  END IF;

  -- Step 4: Archive non-completed assignments and step 5: notify via
  -- SECURITY DEFINER helper (Fix 2 — avoids missing INSERT RLS policy).
  FOR v_assignment IN
    UPDATE chore_assignments
    SET archived = true
    WHERE chore_id = p_chore_id
      AND status <> 'completed'
    RETURNING user_id, reminder_enabled
  LOOP
    IF v_assignment.reminder_enabled THEN
      PERFORM insert_notification(
        v_assignment.user_id,
        v_chore_family_id,
        'chore_deleted',
        'משימה הוסרה',
        'משימה שהיתה ברשימתך הוסרה על ידי מנהל',
        p_chore_id
      );
    END IF;
  END LOOP;

  -- Step 6: Soft-delete the chore (triggers trg_chore_deleted_guard)
  UPDATE chores
  SET status = 'deleted'
  WHERE id = p_chore_id;
END;
$$;
