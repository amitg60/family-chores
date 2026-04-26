-- Fix proposal_resolved notification titles for reward proposals.
-- Migration 031 used chore-specific Hebrew text for both chores and rewards.
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
    v_title_he := CASE WHEN TG_TABLE_NAME = 'rewards'
                       THEN 'הצעת הפרס שלך אושרה'
                       ELSE 'הצעת המשימה שלך אושרה' END;
    v_body_he  := '"' || NEW.title || '" אושרה ונוספה לרשימה';
  ELSE
    v_title_he := CASE WHEN TG_TABLE_NAME = 'rewards'
                       THEN 'הצעת הפרס שלך נדחתה'
                       ELSE 'הצעת המשימה שלך נדחתה' END;
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
