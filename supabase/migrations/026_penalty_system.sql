-- supabase/migrations/026_penalty_system.sql

-- ── 1. chore_assignments: pre-batch waiver flag ─────────────────────────────
ALTER TABLE chore_assignments
  ADD COLUMN IF NOT EXISTS penalty_waived boolean NOT NULL DEFAULT false;

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
WHERE NOT EXISTS (SELECT 1 FROM penalty_policy pp WHERE pp.family_id = families.id)
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
  v_penalty_id  uuid;
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

      -- Floor coins at zero; profiles.coin_balance has no upper cap so reversal is always safe.
      UPDATE profiles
      SET coin_balance = GREATEST(0, coin_balance - v_deduction),
          updated_at   = now()
      WHERE id = r.user_id;

      -- Notification fires automatically via trg_notify_penalty_applied trigger.
      INSERT INTO penalties (chore_assignment_id, user_id, coin_deduction, reason, batch_id)
      VALUES (r.assignment_id, r.user_id, v_deduction, 'overdue', v_batch_id)
      RETURNING id INTO v_penalty_id;

      INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
      VALUES (r.user_id, v_policy.family_id, -v_deduction, 'penalty', v_penalty_id);
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

  IF v_assignment.status <> 'overdue' THEN
    RAISE EXCEPTION 'Can only waive overdue assignments';
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

  -- profiles.coin_balance has no upper cap; this addition is always safe.
  UPDATE profiles
  SET coin_balance = coin_balance + v_penalty.coin_deduction,
      updated_at   = now()
  WHERE id = v_penalty.user_id;

  UPDATE penalties
  SET waived_by = auth.uid(),
      waived_at = now()
  WHERE id = p_penalty_id;

  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
  VALUES (v_penalty.user_id, v_user_family, v_penalty.coin_deduction, 'refund', p_penalty_id);
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
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'weekly-penalties';

SELECT cron.schedule(
  'weekly-penalties',
  '59 23 * * 6',
  'SELECT apply_weekly_penalties()'
);
