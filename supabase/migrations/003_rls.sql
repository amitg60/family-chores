-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================
ALTER TABLE families            ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE chores              ENABLE ROW LEVEL SECURITY;
ALTER TABLE chore_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chore_completions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_offers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalties           ENABLE ROW LEVEL SECURITY;
ALTER TABLE penalty_policy      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback            ENABLE ROW LEVEL SECURITY;
-- coin_transactions_archive has no RLS — only accessed by Edge Functions via service_role

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_family_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT family_id FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- ============================================================
-- FAMILIES
-- ============================================================
CREATE POLICY "families: members can view their own family"
  ON families FOR SELECT
  USING (id = get_my_family_id());

-- ============================================================
-- PROFILES
-- ============================================================
CREATE POLICY "profiles: family members can view each other"
  ON profiles FOR SELECT
  USING (family_id = get_my_family_id());

CREATE POLICY "profiles: users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles: users can update their own non-sensitive fields"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles: admins can update any family member"
  ON profiles FOR UPDATE
  USING (is_admin() AND family_id = get_my_family_id());

-- ============================================================
-- CHORES
-- ============================================================
CREATE POLICY "chores: family members can view"
  ON chores FOR SELECT
  USING (family_id = get_my_family_id());

CREATE POLICY "chores: admins can insert"
  ON chores FOR INSERT
  WITH CHECK (is_admin() AND family_id = get_my_family_id());

CREATE POLICY "chores: players can propose (status=pending_approval)"
  ON chores FOR INSERT
  WITH CHECK (
    family_id = get_my_family_id()
    AND proposed_by = auth.uid()
    AND status = 'pending_approval'
  );

CREATE POLICY "chores: admins can update"
  ON chores FOR UPDATE
  USING (is_admin() AND family_id = get_my_family_id());

-- ============================================================
-- CHORE ASSIGNMENTS
-- ============================================================
CREATE POLICY "assignments: family members can view"
  ON chore_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chores c
      WHERE c.id = chore_id AND c.family_id = get_my_family_id()
    )
  );

CREATE POLICY "assignments: players can insert for themselves; admins can insert for anyone"
  ON chore_assignments FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR is_admin()
  );

CREATE POLICY "assignments: players can update their own"
  ON chore_assignments FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "assignments: admins can update any"
  ON chore_assignments FOR UPDATE
  USING (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM chores c
      WHERE c.id = chore_id AND c.family_id = get_my_family_id()
    )
  );

-- ============================================================
-- CHORE COMPLETIONS
-- ============================================================
CREATE POLICY "completions: submitter can view their own"
  ON chore_completions FOR SELECT
  USING (completed_by = auth.uid());

CREATE POLICY "completions: admins can view all in family"
  ON chore_completions FOR SELECT
  USING (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM chore_assignments ca
        JOIN chores c ON c.id = ca.chore_id
      WHERE ca.id = chore_assignment_id AND c.family_id = get_my_family_id()
    )
  );

CREATE POLICY "completions: players can submit for their own assignments"
  ON chore_completions FOR INSERT
  WITH CHECK (completed_by = auth.uid());

CREATE POLICY "completions: admins can approve/reject"
  ON chore_completions FOR UPDATE
  USING (is_admin());

-- ============================================================
-- REWARDS
-- ============================================================
CREATE POLICY "rewards: family members can view active"
  ON rewards FOR SELECT
  USING (family_id = get_my_family_id());

CREATE POLICY "rewards: admins can insert"
  ON rewards FOR INSERT
  WITH CHECK (is_admin() AND family_id = get_my_family_id());

CREATE POLICY "rewards: players can propose (status=pending_approval)"
  ON rewards FOR INSERT
  WITH CHECK (
    family_id = get_my_family_id()
    AND proposed_by = auth.uid()
    AND status = 'pending_approval'
  );

CREATE POLICY "rewards: admins can update"
  ON rewards FOR UPDATE
  USING (is_admin() AND family_id = get_my_family_id());

-- ============================================================
-- REWARD REDEMPTIONS
-- ============================================================
CREATE POLICY "redemptions: players see their own"
  ON reward_redemptions FOR SELECT
  USING (redeemed_by = auth.uid());

CREATE POLICY "redemptions: admins see all in family"
  ON reward_redemptions FOR SELECT
  USING (
    is_admin()
    AND EXISTS (
      SELECT 1 FROM rewards r
      WHERE r.id = reward_id AND r.family_id = get_my_family_id()
    )
  );

CREATE POLICY "redemptions: players can redeem"
  ON reward_redemptions FOR INSERT
  WITH CHECK (redeemed_by = auth.uid());

CREATE POLICY "redemptions: admins can resolve"
  ON reward_redemptions FOR UPDATE
  USING (is_admin());

-- ============================================================
-- TRADE OFFERS
-- ============================================================
CREATE POLICY "trades: family members can view"
  ON trade_offers FOR SELECT
  USING (family_id = get_my_family_id());

CREATE POLICY "trades: players can post offers"
  ON trade_offers FOR INSERT
  WITH CHECK (offered_by = auth.uid() AND family_id = get_my_family_id());

CREATE POLICY "trades: offerer, target, or admin can update"
  ON trade_offers FOR UPDATE
  USING (
    offered_by = auth.uid()
    OR offered_to = auth.uid()
    OR is_admin()
  );

-- ============================================================
-- COIN TRANSACTIONS (players read-only; inserts via Edge Functions)
-- ============================================================
CREATE POLICY "coin_tx: users see their own"
  ON coin_transactions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "coin_tx: admins see all in family"
  ON coin_transactions FOR SELECT
  USING (is_admin() AND family_id = get_my_family_id());

-- No INSERT/UPDATE/DELETE policies for players.
-- All writes go through Edge Functions using the service_role key.

-- ============================================================
-- ACHIEVEMENTS (public read)
-- ============================================================
CREATE POLICY "achievements: anyone can read"
  ON achievements FOR SELECT
  USING (TRUE);

-- ============================================================
-- PLAYER ACHIEVEMENTS
-- ============================================================
CREATE POLICY "player_achievements: family members can view"
  ON player_achievements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = user_id AND p.family_id = get_my_family_id()
    )
  );

-- ============================================================
-- PENALTIES
-- ============================================================
CREATE POLICY "penalties: players see their own"
  ON penalties FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "penalties: admins see all"
  ON penalties FOR SELECT
  USING (is_admin());

CREATE POLICY "penalties: admins can waive"
  ON penalties FOR UPDATE
  USING (is_admin());

-- ============================================================
-- PENALTY POLICY
-- ============================================================
CREATE POLICY "penalty_policy: family members can view"
  ON penalty_policy FOR SELECT
  USING (family_id = get_my_family_id());

CREATE POLICY "penalty_policy: admins can upsert"
  ON penalty_policy FOR ALL
  USING (is_admin() AND family_id = get_my_family_id());

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE POLICY "notifications: users see their own"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "notifications: users can mark their own as read"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- FEEDBACK
-- ============================================================
CREATE POLICY "feedback: players can submit"
  ON feedback FOR INSERT
  WITH CHECK (user_id = auth.uid() AND family_id = get_my_family_id());

CREATE POLICY "feedback: players can only view their own"
  ON feedback FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "feedback: admins can view all in family"
  ON feedback FOR SELECT
  USING (is_admin() AND family_id = get_my_family_id());

CREATE POLICY "feedback: admins can mark noted/resolved"
  ON feedback FOR UPDATE
  USING (is_admin() AND family_id = get_my_family_id());
