-- ============================================================
-- FIX 1: Harden SECURITY DEFINER functions with pinned search_path
-- (prevents search_path injection attacks)
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_family_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT family_id FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ============================================================
-- FIX 2: Storage upload policy — enforce path ownership
-- (prevent user A from uploading into user B's folder)
-- ============================================================
DROP POLICY IF EXISTS "completion_photos: player can upload" ON storage.objects;
CREATE POLICY "completion_photos: player can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'completion-photos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- FIX 3: Storage delete policy — scope to owner only
-- (the old policy allowed ANY authenticated user to delete ANY photo;
--  service_role bypasses RLS anyway so no service_role policy is needed)
-- ============================================================
DROP POLICY IF EXISTS "completion_photos: service role can delete" ON storage.objects;
CREATE POLICY "completion_photos: owner can delete their own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'completion-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- FIX 4: Prevent players from self-escalating role/coin_balance/trust_level
-- (RLS WITH CHECK cannot restrict which columns change; use a trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_sensitive_profile_self_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  -- Allow admins to change anything
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN NEW;
  END IF;
  -- Players cannot change role, coin_balance, or trust_level
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

CREATE TRIGGER trg_prevent_sensitive_profile_self_update
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_sensitive_profile_self_update();

-- ============================================================
-- FIX 5: chore_assignments INSERT — admin branch needs family scope
-- ============================================================
DROP POLICY IF EXISTS "assignments: players can insert for themselves; admins can inse" ON chore_assignments;
CREATE POLICY "assignments: insert own or admin in family"
  ON chore_assignments FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR (
      is_admin()
      AND EXISTS (
        SELECT 1 FROM chores c
        WHERE c.id = chore_id AND c.family_id = get_my_family_id()
      )
    )
  );

-- ============================================================
-- FIX 6: chore_completions INSERT — verify assignment belongs to submitter
-- ============================================================
DROP POLICY IF EXISTS "completions: players can submit for their own assignments" ON chore_completions;
CREATE POLICY "completions: players can submit for their own assignments"
  ON chore_completions FOR INSERT
  WITH CHECK (
    completed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chore_assignments ca
      WHERE ca.id = chore_assignment_id AND ca.user_id = auth.uid()
    )
  );

-- ============================================================
-- FIX 7: chore_completions UPDATE — admin approval needs family scope
-- ============================================================
DROP POLICY IF EXISTS "completions: admins can approve/reject" ON chore_completions;
CREATE POLICY "completions: admins can approve/reject"
  ON chore_completions FOR UPDATE
  USING (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM chore_assignments ca
        JOIN chores c ON c.id = ca.chore_id
      WHERE ca.id = chore_assignment_id AND c.family_id = get_my_family_id()
    )
  );

-- ============================================================
-- FIX 8+9: penalties SELECT and UPDATE — add family scope
-- ============================================================
DROP POLICY IF EXISTS "penalties: admins see all" ON penalties;
CREATE POLICY "penalties: admins see family"
  ON penalties FOR SELECT
  USING (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM chore_assignments ca
        JOIN chores c ON c.id = ca.chore_id
      WHERE ca.id = chore_assignment_id AND c.family_id = get_my_family_id()
    )
  );

DROP POLICY IF EXISTS "penalties: admins can waive" ON penalties;
CREATE POLICY "penalties: admins can waive"
  ON penalties FOR UPDATE
  USING (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM chore_assignments ca
        JOIN chores c ON c.id = ca.chore_id
      WHERE ca.id = chore_assignment_id AND c.family_id = get_my_family_id()
    )
  );

-- ============================================================
-- FIX 10: reward_redemptions UPDATE — admin resolve needs family scope
-- ============================================================
DROP POLICY IF EXISTS "redemptions: admins can resolve" ON reward_redemptions;
CREATE POLICY "redemptions: admins can resolve"
  ON reward_redemptions FOR UPDATE
  USING (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM rewards r
      WHERE r.id = reward_id AND r.family_id = get_my_family_id()
    )
  );

-- ============================================================
-- FIX 14: trade_offers UPDATE — admin branch needs family scope
-- ============================================================
DROP POLICY IF EXISTS "trades: offerer, target, or admin can update" ON trade_offers;
CREATE POLICY "trades: offerer, target, or admin can update"
  ON trade_offers FOR UPDATE
  USING (
    offered_by = auth.uid()
    OR offered_to = auth.uid()
    OR (is_admin() AND family_id = get_my_family_id())
  );
