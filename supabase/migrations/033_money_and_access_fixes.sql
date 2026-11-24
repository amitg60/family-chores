-- ============================================================
-- Migration 033: money races, completion insert rules, overdue marking,
-- family checks on admin RPCs, profile lockdown, private insert_notification.
-- ============================================================

-- ── 1. Guard triggers police direct client writes only ──────────────────────
-- Both guards were SECURITY DEFINER and keyed on is_admin(), so they also fired
-- inside trusted RPCs: redeem_reward and trust-4 self-approval (player caller),
-- apply_weekly_penalties (cron, no auth.uid()) and cleanup-photos (service_role)
-- all raised. As SECURITY INVOKER, current_user is 'authenticated' only for a
-- direct PostgREST write; inside a SECURITY DEFINER RPC it is the owner.
CREATE OR REPLACE FUNCTION prevent_sensitive_profile_self_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  -- Family membership changes only through invite/signup RPCs.
  IF NEW.family_id IS DISTINCT FROM OLD.family_id THEN
    RAISE EXCEPTION 'family_id cannot be changed';
  END IF;
  IF is_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.role <> OLD.role THEN
    RAISE EXCEPTION 'Players cannot change their own role';
  END IF;
  IF NEW.coin_balance <> OLD.coin_balance THEN
    RAISE EXCEPTION 'Players cannot change their own coin balance';
  END IF;
  IF NEW.trust_level <> OLD.trust_level THEN
    RAISE EXCEPTION 'Players cannot change their own trust level';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_player_assignment_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'authenticated' AND NOT is_admin() THEN
    IF (OLD.chore_id       IS DISTINCT FROM NEW.chore_id)       OR
       (OLD.user_id        IS DISTINCT FROM NEW.user_id)        OR
       (OLD.week_start     IS DISTINCT FROM NEW.week_start)     OR
       (OLD.status         IS DISTINCT FROM NEW.status)         OR
       (OLD.assigned_by    IS DISTINCT FROM NEW.assigned_by)    OR
       (OLD.archived       IS DISTINCT FROM NEW.archived)       OR
       (OLD.penalty_waived IS DISTINCT FROM NEW.penalty_waived)
    THEN
      RAISE EXCEPTION 'FORBIDDEN_FIELD_UPDATE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Players may only submit fresh, pending completions ──────────────────
-- Before: any status/reviewer/date could be inserted, so fake 'approved' rows
-- inflated recalculate_trust_level, and done assignments could be resubmitted.
DROP POLICY IF EXISTS "completions: players can submit for their own assignments" ON chore_completions;
CREATE POLICY "completions: players can submit for their own assignments"
  ON chore_completions FOR INSERT
  WITH CHECK (
    completed_by = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND rejection_reason IS NULL
    AND completed_at <= now()
    AND completed_at > now() - interval '1 minute'
    AND EXISTS (
      SELECT 1 FROM chore_assignments ca
      WHERE ca.id = chore_assignment_id
        AND ca.user_id = auth.uid()
        AND ca.status <> 'completed'
        AND ca.archived = false
    )
  );

-- ── 3. One approved completion per assignment (pays once, ever) ────────────
-- Fails if duplicates already exist; remove them by hand first if so.
CREATE UNIQUE INDEX IF NOT EXISTS uq_completion_per_assignment_approved
  ON chore_completions (chore_assignment_id)
  WHERE status = 'approved';

-- ── 4. approve / reject: row lock + family check for admins too ────────────
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
  -- FOR UPDATE: a concurrent second approval waits here, then sees 'approved'.
  SELECT * INTO v_completion FROM chore_completions WHERE id = completion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completion not found';
  END IF;
  IF v_completion.status <> 'pending' THEN
    RAISE EXCEPTION 'Completion is not pending';
  END IF;

  SELECT * INTO v_assignment FROM chore_assignments WHERE id = v_completion.chore_assignment_id FOR UPDATE;
  SELECT * INTO v_chore      FROM chores             WHERE id = v_assignment.chore_id;

  IF v_assignment.status = 'completed' THEN
    RAISE EXCEPTION 'Assignment already completed';
  END IF;

  SELECT family_id, trust_level INTO v_caller_family, v_caller_trust
  FROM profiles WHERE id = auth.uid();
  IF v_caller_family IS NULL OR v_caller_family <> v_chore.family_id THEN
    RAISE EXCEPTION 'Not authorized: approver is not in the same family as this chore';
  END IF;

  IF NOT is_admin() THEN
    IF COALESCE(v_caller_trust, 1) < 4 THEN
      RAISE EXCEPTION 'Not authorized: trust level too low to approve completions';
    END IF;
    IF v_caller_trust = 4 AND v_completion.completed_by <> auth.uid() THEN
      RAISE EXCEPTION 'Not authorized: trust level 4 may only approve own completions';
    END IF;
  END IF;

  UPDATE chore_completions
    SET status      = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        photo_url   = null
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

CREATE OR REPLACE FUNCTION reject_completion(completion_id UUID, reason TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completion   chore_completions%ROWTYPE;
  v_chore_family uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can reject completions';
  END IF;

  SELECT * INTO v_completion FROM chore_completions WHERE id = completion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completion not found';
  END IF;
  IF v_completion.status <> 'pending' THEN
    RAISE EXCEPTION 'Completion is not pending';
  END IF;

  SELECT c.family_id INTO v_chore_family
  FROM chore_assignments ca JOIN chores c ON c.id = ca.chore_id
  WHERE ca.id = v_completion.chore_assignment_id;
  IF v_chore_family IS DISTINCT FROM get_my_family_id() THEN
    RAISE EXCEPTION 'Not authorized: not in same family';
  END IF;

  UPDATE chore_completions
    SET status           = 'rejected',
        rejection_reason = reason,
        reviewed_by      = auth.uid(),
        reviewed_at      = now(),
        photo_url        = null
    WHERE id = completion_id;

  UPDATE chore_assignments
    SET status = 'pending'
    WHERE id = v_completion.chore_assignment_id;

  PERFORM recalculate_trust_level(v_completion.completed_by);
END;
$$;

-- ── 5. Redemptions: lock + family checks ───────────────────────────────────
CREATE OR REPLACE FUNCTION redeem_reward(p_reward_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reward        rewards%ROWTYPE;
  v_balance       INT;
  v_redemption_id UUID;
BEGIN
  SELECT * INTO v_reward FROM rewards WHERE id = p_reward_id FOR UPDATE;
  IF NOT FOUND OR v_reward.family_id IS DISTINCT FROM get_my_family_id() THEN
    RAISE EXCEPTION 'Reward not found';
  END IF;
  IF v_reward.status <> 'active' THEN
    RAISE EXCEPTION 'Reward is not active';
  END IF;
  IF v_reward.stock IS NOT NULL AND v_reward.stock <= 0 THEN
    RAISE EXCEPTION 'Reward is out of stock';
  END IF;

  SELECT coin_balance INTO v_balance FROM profiles WHERE id = auth.uid() FOR UPDATE;
  IF v_balance < v_reward.coin_cost THEN
    RAISE EXCEPTION 'Insufficient coin balance';
  END IF;

  IF v_reward.stock IS NOT NULL THEN
    UPDATE rewards SET stock = stock - 1 WHERE id = p_reward_id;
  END IF;

  INSERT INTO reward_redemptions (reward_id, redeemed_by, coin_cost_at_time, status)
    VALUES (p_reward_id, auth.uid(), v_reward.coin_cost, 'pending')
    RETURNING id INTO v_redemption_id;

  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
    VALUES (auth.uid(), v_reward.family_id, -v_reward.coin_cost, 'reward_redeemed', v_redemption_id);

  UPDATE profiles
    SET coin_balance = coin_balance - v_reward.coin_cost
    WHERE id = auth.uid();

  RETURN v_redemption_id;
END;
$$;

CREATE OR REPLACE FUNCTION decline_redemption(p_redemption_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redemption reward_redemptions%ROWTYPE;
  v_reward     rewards%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can decline redemptions';
  END IF;

  -- FOR UPDATE: a concurrent second decline waits, then sees 'declined' (no double refund).
  SELECT * INTO v_redemption FROM reward_redemptions WHERE id = p_redemption_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;
  IF v_redemption.status <> 'pending' THEN
    RAISE EXCEPTION 'Redemption is not pending';
  END IF;

  SELECT * INTO v_reward FROM rewards WHERE id = v_redemption.reward_id;
  IF NOT FOUND OR v_reward.family_id IS DISTINCT FROM get_my_family_id() THEN
    RAISE EXCEPTION 'Reward not found';
  END IF;

  IF v_reward.stock IS NOT NULL THEN
    UPDATE rewards SET stock = stock + 1 WHERE id = v_reward.id;
  END IF;

  UPDATE reward_redemptions
    SET status = 'declined', resolved_at = now(), resolved_by = auth.uid()
    WHERE id = p_redemption_id;

  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
    VALUES (v_redemption.redeemed_by, v_reward.family_id, v_redemption.coin_cost_at_time, 'refund', p_redemption_id);

  UPDATE profiles
    SET coin_balance = coin_balance + v_redemption.coin_cost_at_time
    WHERE id = v_redemption.redeemed_by;
END;
$$;

-- Grant is a direct client UPDATE: only pending rows may be resolved, so a
-- stale "grant" after a decline (already refunded) now matches zero rows.
DROP POLICY IF EXISTS "redemptions: admins can resolve" ON reward_redemptions;
CREATE POLICY "redemptions: admins can resolve"
  ON reward_redemptions FOR UPDATE
  USING (
    is_admin()
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM rewards r
      WHERE r.id = reward_id AND r.family_id = get_my_family_id()
    )
  )
  WITH CHECK (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM rewards r
      WHERE r.id = reward_id AND r.family_id = get_my_family_id()
    )
  );

-- ── 6. reverse_penalty: lock so a double click refunds once ────────────────
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

  SELECT * INTO v_penalty FROM penalties WHERE id = p_penalty_id FOR UPDATE;
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

  UPDATE profiles
  SET coin_balance = coin_balance + v_penalty.coin_deduction, updated_at = now()
  WHERE id = v_penalty.user_id;

  UPDATE penalties
  SET waived_by = auth.uid(), waived_at = now()
  WHERE id = p_penalty_id;

  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
  VALUES (v_penalty.user_id, v_user_family, v_penalty.coin_deduction, 'refund', p_penalty_id);
END;
$$;

-- ── 7. Weekly penalties: mark overdue first (nothing else ever did) ────────
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
  v_penalty_id  uuid;
BEGIN
  -- Unfinished assignments whose week has ended (its Saturday has arrived).
  -- shortcut: looks back two weeks only, so the first run does not penalise
  -- months of old backlog; widen if cron is ever down for longer.
  -- Skips assignments with a completion still waiting for review.
  UPDATE chore_assignments ca
  SET status = 'overdue'
  WHERE ca.status IN ('pending', 'in_progress')
    AND ca.archived = false
    AND ca.week_start + 6 <= current_date
    AND ca.week_start > current_date - 14
    AND EXISTS (
      SELECT 1 FROM chores c WHERE c.id = ca.chore_id AND c.status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1 FROM chore_completions cc
      WHERE cc.chore_assignment_id = ca.id AND cc.status = 'pending'
    );

  -- FOR UPDATE: prevents overlapping pg_cron runs from double-deducting.
  FOR v_policy IN SELECT * FROM penalty_policy FOR UPDATE LOOP
    FOR r IN
      SELECT ca.id AS assignment_id, ca.user_id, ca.calendar_day
      FROM chore_assignments ca
      WHERE ca.status         = 'overdue'
        AND ca.penalty_waived = false
        AND ca.archived       = false
        AND EXISTS (
          SELECT 1 FROM chores c
          WHERE c.id = ca.chore_id AND c.family_id = v_policy.family_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM penalties p WHERE p.chore_assignment_id = ca.id
        )
    LOOP
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

      UPDATE profiles
      SET coin_balance = GREATEST(0, coin_balance - v_deduction), updated_at = now()
      WHERE id = r.user_id;

      INSERT INTO penalties (chore_assignment_id, user_id, coin_deduction, reason, batch_id)
      VALUES (r.assignment_id, r.user_id, v_deduction, 'overdue', v_batch_id)
      RETURNING id INTO v_penalty_id;

      INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
      VALUES (r.user_id, v_policy.family_id, -v_deduction, 'penalty', v_penalty_id);
    END LOOP;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION apply_weekly_penalties() FROM PUBLIC, anon, authenticated;

-- ── 8. Admin RPCs: target must be in the caller's family ───────────────────
-- p_family_id is kept for client compatibility but no longer trusted.
CREATE OR REPLACE FUNCTION grant_manual_bonus(
  p_target_user_id uuid,
  p_amount         integer,
  p_family_id      uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id uuid := get_my_family_id();
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'caller is not an admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_target_user_id AND family_id = v_family_id) THEN
    RAISE EXCEPTION 'target is not in your family';
  END IF;
  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
  VALUES (p_target_user_id, v_family_id, p_amount, 'manual_bonus', null);
  UPDATE profiles
  SET coin_balance = coin_balance + p_amount, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION set_trust_level(
  p_target_user_id uuid,
  p_new_level      integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_new_level < 1 OR p_new_level > 5 THEN
    RAISE EXCEPTION 'trust level must be between 1 and 5';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'caller is not an admin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_target_user_id AND family_id = get_my_family_id()) THEN
    RAISE EXCEPTION 'target is not in your family';
  END IF;
  UPDATE profiles
  SET trust_level = p_new_level, updated_at = now()
  WHERE id = p_target_user_id;
END;
$$;

-- ── 9. Profiles are created only by redeem_invite / create_family_and_admin ─
-- The open INSERT policy let any signup insert itself as admin of any family.
DROP POLICY IF EXISTS "profiles: users can insert their own profile" ON profiles;

CREATE OR REPLACE FUNCTION create_family_and_admin(
  p_family_name text,
  p_team_name   text,
  p_admin_name  text,
  p_user_id     uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_family_id uuid;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  INSERT INTO families (name, team_name)
  VALUES (p_family_name, NULLIF(TRIM(p_team_name), ''))
  RETURNING id INTO v_family_id;

  INSERT INTO profiles (id, family_id, name, role)
  VALUES (p_user_id, v_family_id, p_admin_name, 'admin');
END;
$$;

-- ── 10. insert_notification is internal: triggers and RPCs only ────────────
-- Supabase grants EXECUTE on new public functions to anon/authenticated, so any
-- client could send any user a fake notification.
REVOKE EXECUTE ON FUNCTION insert_notification(uuid, uuid, notification_type, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- delete_chore was SECURITY INVOKER and calls insert_notification; run it as
-- owner so it keeps working. It already checks admin + same family itself.
ALTER FUNCTION delete_chore(uuid) SECURITY DEFINER;
