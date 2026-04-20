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

  -- approved_count >= 9 out of 10 → promote  (>=90%; boundary included)
  -- approved_count < 7  out of 10 → demote   (<70%; boundary excluded -> 70% = no change)
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
  -- Guard against NULL family_id: notifications.family_id is NOT NULL, so skip if user has no family.
  IF v_family_id IS NOT NULL THEN
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
  END IF;
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

    -- Rule 2: trust level must be at least 4 (levels 1-3 cannot approve)
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
    -- (level >= 5 and rules 1-3 passed -> no further restriction)
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
--    Uses auth.uid() internally - players can only fetch their own data.
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
