-- redeem_reward: called by a player.
-- Validates stock and balance, atomically deducts coins and creates a pending redemption.
CREATE OR REPLACE FUNCTION redeem_reward(p_reward_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reward        rewards%ROWTYPE;
  v_balance       INT;
  v_redemption_id UUID;
BEGIN
  SELECT * INTO v_reward FROM rewards WHERE id = p_reward_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reward not found';
  END IF;
  IF v_reward.status <> 'active' THEN
    RAISE EXCEPTION 'Reward is not active';
  END IF;
  IF v_reward.stock IS NOT NULL AND v_reward.stock <= 0 THEN
    RAISE EXCEPTION 'Reward is out of stock';
  END IF;

  SELECT coin_balance INTO v_balance FROM profiles WHERE id = auth.uid();
  IF v_balance < v_reward.coin_cost THEN
    RAISE EXCEPTION 'Insufficient coin balance';
  END IF;

  -- Decrement stock if limited
  IF v_reward.stock IS NOT NULL THEN
    UPDATE rewards SET stock = stock - 1 WHERE id = p_reward_id;
  END IF;

  -- Create pending redemption
  INSERT INTO reward_redemptions (reward_id, redeemed_by, coin_cost_at_time, status)
    VALUES (p_reward_id, auth.uid(), v_reward.coin_cost, 'pending')
    RETURNING id INTO v_redemption_id;

  -- Deduct coins
  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
    VALUES (auth.uid(), v_reward.family_id, -v_reward.coin_cost, 'reward_redeemed', v_redemption_id);

  UPDATE profiles
    SET coin_balance = coin_balance - v_reward.coin_cost
    WHERE id = auth.uid();

  RETURN v_redemption_id;
END;
$$;

-- decline_redemption: admin only.
-- Marks redemption declined, restores stock, and refunds coins atomically.
CREATE OR REPLACE FUNCTION decline_redemption(p_redemption_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_redemption reward_redemptions%ROWTYPE;
  v_reward     rewards%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can decline redemptions';
  END IF;

  SELECT * INTO v_redemption FROM reward_redemptions WHERE id = p_redemption_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;
  IF v_redemption.status <> 'pending' THEN
    RAISE EXCEPTION 'Redemption is not pending';
  END IF;

  SELECT * INTO v_reward FROM rewards WHERE id = v_redemption.reward_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reward not found';
  END IF;

  -- Restore stock if reward has a limit
  IF v_reward.stock IS NOT NULL THEN
    UPDATE rewards SET stock = stock + 1 WHERE id = v_reward.id;
  END IF;

  UPDATE reward_redemptions
    SET status = 'declined',
        resolved_at = now(),
        resolved_by = auth.uid()
    WHERE id = p_redemption_id;

  -- Refund coins
  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
    VALUES (
      v_redemption.redeemed_by,
      v_reward.family_id,
      v_redemption.coin_cost_at_time,
      'refund',
      p_redemption_id
    );

  UPDATE profiles
    SET coin_balance = coin_balance + v_redemption.coin_cost_at_time
    WHERE id = v_redemption.redeemed_by;
END;
$$;
