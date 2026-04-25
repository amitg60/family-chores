-- ─────────────────────────────────────────────────────────────────────────────
-- 1. system_logs table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name  TEXT        NOT NULL,
  run_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result         JSONB       NOT NULL,
  had_errors     BOOLEAN     NOT NULL DEFAULT FALSE
);

ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

-- Admins can read all logs
CREATE POLICY "system_logs: admins can read"
  ON system_logs FOR SELECT
  USING (is_admin());

-- No client INSERT/UPDATE/DELETE — Edge Functions write via service_role only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Partial indexes for cleanup-photos Edge Function queries
-- ─────────────────────────────────────────────────────────────────────────────

-- Job 1: find approved/rejected completions that still hold a photo path
CREATE INDEX IF NOT EXISTS idx_completions_orphaned_photos
  ON chore_completions (status)
  WHERE photo_url IS NOT NULL;

-- Job 2: find stale pending completions by age
CREATE INDEX IF NOT EXISTS idx_completions_stale_pending
  ON chore_completions (completed_at)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. approve_completion — add photo_url = null
--    Full function copy from migration 025 with one added line.
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
    SELECT family_id, trust_level INTO v_caller_family, v_caller_trust
    FROM profiles WHERE id = auth.uid();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not authorized: caller has no profile';
    END IF;

    IF COALESCE(v_caller_trust, 1) < 4 THEN
      RAISE EXCEPTION 'Not authorized: trust level too low to approve completions';
    END IF;

    IF v_caller_family IS NULL OR v_caller_family <> v_chore.family_id THEN
      RAISE EXCEPTION 'Not authorized: approver is not in the same family as this chore';
    END IF;

    IF v_caller_trust = 4 AND v_completion.completed_by <> auth.uid() THEN
      RAISE EXCEPTION 'Not authorized: trust level 4 may only approve own completions';
    END IF;
  END IF;

  UPDATE chore_completions
    SET status      = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        photo_url   = null            -- nulled atomically; DB is source of truth
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
-- 4. reject_completion — add photo_url = null
--    Full function copy from migration 025 with one added line.
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
    SET status           = 'rejected',
        rejection_reason = reason,
        reviewed_by      = auth.uid(),
        reviewed_at      = now(),
        photo_url        = null       -- nulled atomically; DB is source of truth
    WHERE id = completion_id;

  UPDATE chore_assignments
    SET status = 'pending'
    WHERE id = v_completion.chore_assignment_id;

  PERFORM recalculate_trust_level(v_completion.completed_by);
END;
$$;
