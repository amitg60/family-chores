-- approve_completion: awards coins atomically.
-- Callable by admins OR by the completing player if trust_level >= 4 (self-verification).
CREATE OR REPLACE FUNCTION approve_completion(completion_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_completion  chore_completions%ROWTYPE;
  v_assignment  chore_assignments%ROWTYPE;
  v_chore       chores%ROWTYPE;
  v_trust_level int;
BEGIN
  SELECT * INTO v_completion FROM chore_completions WHERE id = completion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completion not found';
  END IF;
  IF v_completion.status <> 'pending' THEN
    RAISE EXCEPTION 'Completion is not pending';
  END IF;

  -- Authorization: admin OR the submitting player with trust_level >= 4
  IF NOT is_admin() THEN
    SELECT trust_level INTO v_trust_level FROM profiles WHERE id = auth.uid();
    IF v_completion.completed_by <> auth.uid() OR COALESCE(v_trust_level, 1) < 4 THEN
      RAISE EXCEPTION 'Not authorized to approve this completion';
    END IF;
  END IF;

  SELECT * INTO v_assignment FROM chore_assignments WHERE id = v_completion.chore_assignment_id;
  SELECT * INTO v_chore FROM chores WHERE id = v_assignment.chore_id;

  UPDATE chore_completions
    SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = completion_id;

  UPDATE chore_assignments SET status = 'completed' WHERE id = v_assignment.id;

  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
    VALUES (v_completion.completed_by, v_chore.family_id, v_chore.coin_value, 'chore_completed', completion_id);

  UPDATE profiles
    SET coin_balance = coin_balance + v_chore.coin_value
    WHERE id = v_completion.completed_by;
END;
$$;

-- reject_completion: admin only. Resets assignment to pending so player can resubmit.
CREATE OR REPLACE FUNCTION reject_completion(completion_id UUID, reason TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    SET status = 'rejected',
        rejection_reason = reason,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = completion_id;

  UPDATE chore_assignments
    SET status = 'pending'
    WHERE id = v_completion.chore_assignment_id;
END;
$$;
