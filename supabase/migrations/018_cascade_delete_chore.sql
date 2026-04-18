ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'chore_deleted';

-- ============================================================
-- RPC: delete_chore
-- Sole enforcement point for all business rules.
-- SECURITY INVOKER: runs as calling user — RLS stays active.
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
BEGIN
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

  -- Steps 4+5: Archive non-completed assignments; notify reminder players.
  -- Single CTE statement — atomic, all-or-nothing with the rest of the tx.
  WITH archived AS (
    UPDATE chore_assignments
    SET archived = true
    WHERE chore_id = p_chore_id
      AND status <> 'completed'
    RETURNING user_id, reminder_enabled
  )
  INSERT INTO notifications
    (user_id, family_id, type, title_he, body_he, related_entity_id, read)
  SELECT
    a.user_id,
    v_chore_family_id,
    'chore_deleted',
    'משימה הוסרה',
    'משימה שהיתה ברשימתך הוסרה על ידי מנהל',
    p_chore_id,
    false
  FROM archived a
  WHERE a.reminder_enabled = true;

  -- Step 6: Soft-delete the chore (triggers trg_chore_deleted_guard)
  UPDATE chores
  SET status = 'deleted'
  WHERE id = p_chore_id;
END;
$$;

-- ============================================================
-- Trigger function: full bypass guard
-- Fires on direct UPDATE chores SET status='deleted' paths.
-- Re-checks pending completions AND cascades assignment archiving.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_chore_deleted_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Re-check pending completions (catches direct-bypass attempts)
  IF EXISTS (
    SELECT 1
    FROM chore_completions cc
    JOIN chore_assignments ca ON cc.chore_assignment_id = ca.id
    WHERE ca.chore_id = NEW.id
      AND cc.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'PENDING_COMPLETIONS';
  END IF;

  -- Cascade archive non-completed assignments.
  -- When called via RPC, assignments are already archived → no-op.
  -- When called via direct bypass, this performs the full cascade.
  UPDATE chore_assignments
  SET archived = true
  WHERE chore_id = NEW.id
    AND status <> 'completed';

  RETURN NEW;
END;
$$;

-- BEFORE UPDATE trigger on chores — fires only on 'deleted' transition
DROP TRIGGER IF EXISTS trg_chore_deleted_guard ON chores;
CREATE TRIGGER trg_chore_deleted_guard
  BEFORE UPDATE ON chores
  FOR EACH ROW
  WHEN (NEW.status = 'deleted' AND OLD.status IS DISTINCT FROM 'deleted')
  EXECUTE FUNCTION fn_chore_deleted_guard();
