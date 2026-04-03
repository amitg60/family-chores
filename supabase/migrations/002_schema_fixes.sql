-- ============================================================
-- INDEXES ON FK COLUMNS
-- (PostgreSQL does not auto-create indexes for FKs)
-- ============================================================

-- profiles
CREATE INDEX idx_profiles_family_id ON profiles(family_id);

-- chores
CREATE INDEX idx_chores_family_id ON chores(family_id);
CREATE INDEX idx_chores_assigned_to ON chores(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_chores_proposed_by ON chores(proposed_by) WHERE proposed_by IS NOT NULL;

-- chore_assignments
CREATE INDEX idx_chore_assignments_chore_id ON chore_assignments(chore_id);
CREATE INDEX idx_chore_assignments_user_id ON chore_assignments(user_id);
CREATE INDEX idx_chore_assignments_week_start ON chore_assignments(week_start);
CREATE INDEX idx_chore_assignments_user_week ON chore_assignments(user_id, week_start) WHERE archived = FALSE;

-- chore_completions
CREATE INDEX idx_chore_completions_assignment_id ON chore_completions(chore_assignment_id);
CREATE INDEX idx_chore_completions_completed_by ON chore_completions(completed_by);

-- rewards
CREATE INDEX idx_rewards_family_id ON rewards(family_id);

-- reward_redemptions
CREATE INDEX idx_reward_redemptions_reward_id ON reward_redemptions(reward_id);
CREATE INDEX idx_reward_redemptions_redeemed_by ON reward_redemptions(redeemed_by);

-- trade_offers
CREATE INDEX idx_trade_offers_family_id ON trade_offers(family_id);
CREATE INDEX idx_trade_offers_offered_by ON trade_offers(offered_by);
CREATE INDEX idx_trade_offers_offered_to ON trade_offers(offered_to) WHERE offered_to IS NOT NULL;

-- coin_transactions
CREATE INDEX idx_coin_transactions_user_id ON coin_transactions(user_id);
CREATE INDEX idx_coin_transactions_family_id ON coin_transactions(family_id);
CREATE INDEX idx_coin_transactions_created_at ON coin_transactions(created_at DESC);

-- coin_transactions_archive
CREATE INDEX idx_coin_tx_archive_user_id ON coin_transactions_archive(user_id);
CREATE INDEX idx_coin_tx_archive_created_at ON coin_transactions_archive(created_at DESC);

-- notifications (composite for the hot-path: unread for user, newest first)
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE read = FALSE;
CREATE INDEX idx_notifications_user_id ON notifications(user_id);

-- player_achievements
CREATE INDEX idx_player_achievements_user_id ON player_achievements(user_id);

-- penalties
CREATE INDEX idx_penalties_chore_assignment_id ON penalties(chore_assignment_id);
CREATE INDEX idx_penalties_user_id ON penalties(user_id);

-- feedback
CREATE INDEX idx_feedback_family_id ON feedback(family_id);
CREATE INDEX idx_feedback_user_id ON feedback(user_id);

-- ============================================================
-- UNIQUENESS GUARDS
-- ============================================================

-- Prevent duplicate active assignments for the same chore+user+week
CREATE UNIQUE INDEX uq_chore_assignment_active
  ON chore_assignments(chore_id, user_id, week_start)
  WHERE archived = FALSE;

-- Prevent multiple pending completions per assignment
CREATE UNIQUE INDEX uq_completion_per_assignment_pending
  ON chore_completions(chore_assignment_id)
  WHERE status = 'pending';

-- ============================================================
-- CONSTRAINT FIXES
-- ============================================================

-- Fix: penalty_policy.updated_by should not cascade-delete the policy when an admin leaves.
-- Change to SET NULL and make nullable.
ALTER TABLE penalty_policy
  DROP CONSTRAINT penalty_policy_updated_by_fkey;

ALTER TABLE penalty_policy
  ALTER COLUMN updated_by DROP NOT NULL;

ALTER TABLE penalty_policy
  ADD CONSTRAINT penalty_policy_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- Fix: rewards.stock must be non-negative if set
ALTER TABLE rewards
  ADD CONSTRAINT chk_rewards_stock_non_negative
  CHECK (stock IS NULL OR stock >= 0);

-- Fix: chores.last_traded_price must be non-negative if set
ALTER TABLE chores
  ADD CONSTRAINT chk_chores_last_traded_price_non_negative
  CHECK (last_traded_price IS NULL OR last_traded_price >= 0);

-- Fix: calendar_day and calendar_slot must both be set or both be null
ALTER TABLE chore_assignments
  ADD CONSTRAINT chk_calendar_consistency
  CHECK (
    (calendar_day IS NULL AND calendar_slot IS NULL)
    OR (calendar_day IS NOT NULL AND calendar_slot IS NOT NULL)
  );

-- Fix: trade_offers must carry at least some value (not a completely empty offer)
ALTER TABLE trade_offers
  ADD CONSTRAINT chk_trade_offer_has_value
  CHECK (
    chore_offered IS NOT NULL
    OR chore_requested IS NOT NULL
    OR coins_offered > 0
    OR coins_requested > 0
  );

-- ============================================================
-- UPDATED_AT AUTO-TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_chores_updated_at
  BEFORE UPDATE ON chores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_chore_assignments_updated_at
  BEFORE UPDATE ON chore_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_rewards_updated_at
  BEFORE UPDATE ON rewards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_penalty_policy_updated_at
  BEFORE UPDATE ON penalty_policy
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON COLUMN profiles.coin_balance IS
  'Denormalized cache of the player''s coin balance. MUST be updated atomically in the same
   transaction as a coin_transactions INSERT. Use: UPDATE profiles SET coin_balance =
   coin_balance + :amount WHERE id = :id AND coin_balance + :amount >= 0. The CHECK (>= 0)
   rejects explicit negative writes but does NOT prevent race conditions — always use a
   single atomic UPDATE with coin_balance + :amount to avoid concurrent deduction bugs.';

COMMENT ON TABLE coin_transactions_archive IS
  'Archive of coin_transactions rows older than 12 months. Moved here by a weekly Edge
   Function cron job. No RLS — only accessible via service_role key. No foreign keys
   (referenced rows may have been deleted). The coin_balance on profiles remains accurate
   as it is maintained via direct UPDATE, not derived from this table.';

COMMENT ON COLUMN chores.assigned_to IS
  'Optional default assignee for this chore. For recurring chores this pre-fills
   chore_assignments each week. For open-pool chores this is NULL. The authoritative
   per-week assignment is the chore_assignments table — this column drives the initial
   assignment only.';
