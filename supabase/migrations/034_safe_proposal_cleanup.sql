-- ============================================================
-- Migration 034: only delete proposals that were never used.
-- Before: "archived + proposed_by set" also matched kid proposals that were
-- approved, used and later archived; the hard delete cascaded away their
-- assignments, completions, penalties and redemptions.
-- A rejected proposal never got assignments/redemptions, so "no dependent
-- rows" identifies it without relying on approved_by or a rejection reason
-- (rewards never set approved_by, and the reason is optional).
-- ============================================================

CREATE OR REPLACE FUNCTION dismiss_rejected_proposal(
  p_entity_type TEXT,
  p_entity_id   UUID
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_entity_type = 'chore' THEN
    DELETE FROM chores c
    WHERE c.id = p_entity_id
      AND c.proposed_by = auth.uid()
      AND c.status = 'archived'
      AND NOT EXISTS (SELECT 1 FROM chore_assignments ca WHERE ca.chore_id = c.id);
  ELSIF p_entity_type = 'reward' THEN
    DELETE FROM rewards r
    WHERE r.id = p_entity_id
      AND r.proposed_by = auth.uid()
      AND r.status = 'archived'
      AND NOT EXISTS (SELECT 1 FROM reward_redemptions rr WHERE rr.reward_id = r.id);
  ELSE
    RAISE EXCEPTION 'Invalid entity type: %', p_entity_type;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found or not authorized';
  END IF;
END;
$$;

-- Weekly cleanup (called by cleanup-photos with service_role). Returns rows deleted.
CREATE OR REPLACE FUNCTION delete_stale_rejected_proposals(p_older_than timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chores  integer;
  v_rewards integer;
BEGIN
  DELETE FROM chores c
  WHERE c.status = 'archived'
    AND c.proposed_by IS NOT NULL
    AND c.updated_at < p_older_than
    AND NOT EXISTS (SELECT 1 FROM chore_assignments ca WHERE ca.chore_id = c.id);
  GET DIAGNOSTICS v_chores = ROW_COUNT;

  DELETE FROM rewards r
  WHERE r.status = 'archived'
    AND r.proposed_by IS NOT NULL
    AND r.updated_at < p_older_than
    AND NOT EXISTS (SELECT 1 FROM reward_redemptions rr WHERE rr.reward_id = r.id);
  GET DIAGNOSTICS v_rewards = ROW_COUNT;

  RETURN v_chores + v_rewards;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_stale_rejected_proposals(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_stale_rejected_proposals(timestamptz) TO service_role;
