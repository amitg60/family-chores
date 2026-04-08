-- ============================================================
-- NOTIFICATION INSERT HELPER
-- ============================================================
CREATE OR REPLACE FUNCTION insert_notification(
  p_user_id           uuid,
  p_family_id         uuid,
  p_type              notification_type,
  p_title_he          text,
  p_body_he           text,
  p_related_entity_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
  VALUES (p_user_id, p_family_id, p_type, p_title_he, p_body_he, p_related_entity_id);
END;
$$;

-- ============================================================
-- TRIGGER 1: chore_assigned
-- Fires AFTER INSERT on chore_assignments
-- ============================================================
CREATE OR REPLACE FUNCTION notify_chore_assigned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_chore_title text;
  v_family_id   uuid;
BEGIN
  SELECT title, family_id INTO v_chore_title, v_family_id
  FROM chores WHERE id = NEW.chore_id;

  PERFORM insert_notification(
    NEW.user_id,
    v_family_id,
    'chore_assigned',
    'הוקצתה לך משימה חדשה',
    COALESCE(v_chore_title, 'משימה'),
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_chore_assigned
  AFTER INSERT ON chore_assignments
  FOR EACH ROW EXECUTE FUNCTION notify_chore_assigned();

-- ============================================================
-- TRIGGER 2: completion_reviewed
-- Fires AFTER UPDATE on chore_completions when status → approved/rejected
-- ============================================================
CREATE OR REPLACE FUNCTION notify_completion_reviewed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id uuid;
  v_title_he  text;
  v_body_he   text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved', 'rejected') THEN RETURN NEW; END IF;

  SELECT family_id INTO v_family_id FROM profiles WHERE id = NEW.completed_by;

  IF NEW.status = 'approved' THEN
    v_title_he := 'הגשתך אושרה';
    v_body_he  := 'כל הכבוד! הגשתך אושרה ומטבעות נזכו לחשבונך';
  ELSE
    v_title_he := 'הגשתך נדחתה';
    v_body_he  := COALESCE('הגשתך נדחתה. סיבה: ' || NEW.rejection_reason, 'הגשתך נדחתה');
  END IF;

  PERFORM insert_notification(
    NEW.completed_by, v_family_id, 'completion_reviewed',
    v_title_he, v_body_he, NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_completion_reviewed
  AFTER UPDATE ON chore_completions
  FOR EACH ROW EXECUTE FUNCTION notify_completion_reviewed();

-- ============================================================
-- TRIGGER 3: trade_received
-- Fires AFTER INSERT on trade_offers when offered_to IS NOT NULL
-- ============================================================
CREATE OR REPLACE FUNCTION notify_trade_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sender_name text;
BEGIN
  IF NEW.offered_to IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_sender_name FROM profiles WHERE id = NEW.offered_by;

  PERFORM insert_notification(
    NEW.offered_to, NEW.family_id, 'trade_received',
    'קיבלת הצעת עסקה',
    COALESCE(v_sender_name, 'מישהו') || ' שלח/ה לך הצעת עסקה',
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_trade_received
  AFTER INSERT ON trade_offers
  FOR EACH ROW EXECUTE FUNCTION notify_trade_received();

-- ============================================================
-- TRIGGER 4: trade_resolved
-- Fires AFTER UPDATE on trade_offers when status → accepted/declined
-- ============================================================
CREATE OR REPLACE FUNCTION notify_trade_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_title_he text;
  v_body_he  text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('accepted', 'declined') THEN RETURN NEW; END IF;

  IF NEW.status = 'accepted' THEN
    v_title_he := 'העסקה שלך התקבלה';
    v_body_he  := 'הצעת העסקה שלך התקבלה';
  ELSE
    v_title_he := 'העסקה שלך נדחתה';
    v_body_he  := 'הצעת העסקה שלך נדחתה';
  END IF;

  PERFORM insert_notification(
    NEW.offered_by, NEW.family_id, 'trade_resolved',
    v_title_he, v_body_he, NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_trade_resolved
  AFTER UPDATE ON trade_offers
  FOR EACH ROW EXECUTE FUNCTION notify_trade_resolved();

-- ============================================================
-- TRIGGER 5: redemption_resolved
-- Fires AFTER UPDATE on reward_redemptions when status → granted/declined
-- ============================================================
CREATE OR REPLACE FUNCTION notify_redemption_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id   uuid;
  v_reward_title text;
  v_title_he    text;
  v_body_he     text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('granted', 'declined') THEN RETURN NEW; END IF;

  SELECT r.family_id, r.title INTO v_family_id, v_reward_title
  FROM rewards r WHERE r.id = NEW.reward_id;

  IF NEW.status = 'granted' THEN
    v_title_he := 'בקשת המימוש אושרה';
    v_body_he  := 'בקשת המימוש שלך עבור "' || COALESCE(v_reward_title, 'הפרס') || '" אושרה';
  ELSE
    v_title_he := 'בקשת המימוש נדחתה';
    v_body_he  := 'בקשת המימוש שלך עבור "' || COALESCE(v_reward_title, 'הפרס') || '" נדחתה';
  END IF;

  PERFORM insert_notification(
    NEW.redeemed_by, v_family_id, 'redemption_resolved',
    v_title_he, v_body_he, NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_redemption_resolved
  AFTER UPDATE ON reward_redemptions
  FOR EACH ROW EXECUTE FUNCTION notify_redemption_resolved();

-- ============================================================
-- TRIGGER 6: proposal_resolved
-- Fires AFTER UPDATE on chores when status changes from pending_approval
-- Only when proposed_by IS NOT NULL (i.e., player-proposed chore)
-- ============================================================
CREATE OR REPLACE FUNCTION notify_proposal_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_title_he text;
  v_body_he  text;
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
    v_body_he  := '"' || NEW.title || '" נדחתה על ידי המנהל';
  END IF;

  PERFORM insert_notification(
    NEW.proposed_by, NEW.family_id, 'proposal_resolved',
    v_title_he, v_body_he, NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_proposal_resolved
  AFTER UPDATE ON chores
  FOR EACH ROW EXECUTE FUNCTION notify_proposal_resolved();

-- ============================================================
-- TRIGGER 7: penalty_applied
-- Fires AFTER INSERT on penalties
-- ============================================================
CREATE OR REPLACE FUNCTION notify_penalty_applied()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id FROM profiles WHERE id = NEW.user_id;

  PERFORM insert_notification(
    NEW.user_id, v_family_id, 'penalty_applied',
    'הוטל עליך קנס',
    'נוכו ' || NEW.coin_deduction::text || ' מטבעות. סיבה: ' || NEW.reason,
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_penalty_applied
  AFTER INSERT ON penalties
  FOR EACH ROW EXECUTE FUNCTION notify_penalty_applied();

-- ============================================================
-- TRIGGER 8: achievement_earned
-- Fires AFTER INSERT on player_achievements
-- ============================================================
CREATE OR REPLACE FUNCTION notify_achievement_earned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id  uuid;
  v_title_he   text;
  v_icon       text;
BEGIN
  SELECT family_id INTO v_family_id FROM profiles WHERE id = NEW.user_id;
  SELECT title_he, icon INTO v_title_he, v_icon
  FROM achievements WHERE id = NEW.achievement_id;

  PERFORM insert_notification(
    NEW.user_id, v_family_id, 'achievement_earned',
    'זכית בהישג חדש!',
    COALESCE(v_icon || ' ', '') || COALESCE(v_title_he, 'הישג חדש'),
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_achievement_earned
  AFTER INSERT ON player_achievements
  FOR EACH ROW EXECUTE FUNCTION notify_achievement_earned();
