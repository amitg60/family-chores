-- Add resolved_by to reward_redemptions.
-- Tracks which admin granted or declined each redemption.
ALTER TABLE reward_redemptions
  ADD COLUMN resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
