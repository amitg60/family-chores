-- ============================================================
-- Migration 031: Kid-proposed chores & rewards
-- New columns, notification type, triggers, RPC, cleanup job prep
-- ============================================================

-- ── 1. New columns ────────────────────────────────────────────────────────────
ALTER TABLE chores  ADD COLUMN IF NOT EXISTS proposal_rejection_reason TEXT NULL
  CHECK (proposal_rejection_reason IS NULL OR char_length(proposal_rejection_reason) <= 500);
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS proposal_rejection_reason TEXT NULL
  CHECK (proposal_rejection_reason IS NULL OR char_length(proposal_rejection_reason) <= 500);

-- ── 2. New notification type ─────────────────────────────────────────────────
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'proposal_submitted';

-- ── 3. Performance index for admin lookups ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_family_admins
  ON profiles (family_id)
  WHERE role = 'admin';

-- ── 4. Trigger: notify admins when a chore proposal is submitted ──────────────
CREATE OR REPLACE FUNCTION notify_chore_proposal_submitted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposer_name TEXT;
  v_admin         RECORD;
BEGIN
  IF NEW.proposed_by IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'pending_approval' THEN RETURN NEW; END IF;

  SELECT name INTO v_proposer_name FROM profiles WHERE id = NEW.proposed_by;

  FOR v_admin IN
    SELECT id FROM profiles WHERE family_id = NEW.family_id AND role = 'admin'
  LOOP
    PERFORM insert_notification(
      v_admin.id,
      NEW.family_id,
      'proposal_submitted',
      'הצעת משימה חדשה',
      '"' || NEW.title || '" הוצע על ידי ' || COALESCE(v_proposer_name, 'שחקן'),
      NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_chore_proposal_submitted
  AFTER INSERT ON chores
  FOR EACH ROW EXECUTE FUNCTION notify_chore_proposal_submitted();

-- ── 5. Trigger: notify admins when a reward proposal is submitted ─────────────
CREATE OR REPLACE FUNCTION notify_reward_proposal_submitted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposer_name TEXT;
  v_admin         RECORD;
BEGIN
  IF NEW.proposed_by IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'pending_approval' THEN RETURN NEW; END IF;

  SELECT name INTO v_proposer_name FROM profiles WHERE id = NEW.proposed_by;

  FOR v_admin IN
    SELECT id FROM profiles WHERE family_id = NEW.family_id AND role = 'admin'
  LOOP
    PERFORM insert_notification(
      v_admin.id,
      NEW.family_id,
      'proposal_submitted',
      'הצעת פרס חדש',
      '"' || NEW.title || '" הוצע על ידי ' || COALESCE(v_proposer_name, 'שחקן'),
      NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_reward_proposal_submitted
  AFTER INSERT ON rewards
  FOR EACH ROW EXECUTE FUNCTION notify_reward_proposal_submitted();

-- ── 6. Update notify_proposal_resolved: include rejection reason + cover rewards
--    Original function (migration 012) only fired on chores and lacked reason.
CREATE OR REPLACE FUNCTION notify_proposal_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title_he TEXT;
  v_body_he  TEXT;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.proposed_by IS NULL THEN RETURN NEW; END IF;
  IF OLD.status != 'pending_approval' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('active', 'archived') THEN RETURN NEW; END IF;

  IF NEW.status = 'active' THEN
    v_title_he := 'הצעת המשימה שלך אושרה';
    v_body_he  := '"' || NEW.title || '" אושרה ונוספה לרשימת המשימות';
  ELSE
    v_title_he := 'הצעת המשימה שלך נדחתה';
    v_body_he  := '"' || NEW.title || '" נדחתה על ידי המנהל'
                  || CASE WHEN NEW.proposal_rejection_reason IS NOT NULL
                          THEN ': ' || NEW.proposal_rejection_reason
                          ELSE '' END;
  END IF;

  PERFORM insert_notification(
    NEW.proposed_by, NEW.family_id, 'proposal_resolved',
    v_title_he, v_body_he, NEW.id
  );
  RETURN NEW;
END;
$$;

-- trg_notify_proposal_resolved already exists on chores (migration 012) — no re-create needed.
-- Add matching trigger for rewards:
DROP TRIGGER IF EXISTS trg_notify_reward_proposal_resolved ON rewards;
CREATE TRIGGER trg_notify_reward_proposal_resolved
  AFTER UPDATE ON rewards
  FOR EACH ROW EXECUTE FUNCTION notify_proposal_resolved();

-- ── 7. RPC: player dismisses a rejected proposal ─────────────────────────────
CREATE OR REPLACE FUNCTION dismiss_rejected_proposal(
  p_entity_type TEXT,
  p_entity_id   UUID
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_entity_type = 'chore' THEN
    DELETE FROM chores
    WHERE id = p_entity_id
      AND proposed_by = auth.uid()
      AND status = 'archived';
  ELSIF p_entity_type = 'reward' THEN
    DELETE FROM rewards
    WHERE id = p_entity_id
      AND proposed_by = auth.uid()
      AND status = 'archived';
  ELSE
    RAISE EXCEPTION 'Invalid entity type: %', p_entity_type;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found or not authorized';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION dismiss_rejected_proposal(TEXT, UUID) TO authenticated;
