-- supabase/migrations/028_fix_calendar_slot_type.sql
-- Fix SQLSTATE 42883: p_slot and v_slot were declared as text but calendar_slot
-- column is a custom enum type. PostgreSQL has no implicit text = calendar_slot
-- operator, so comparisons and assignments fail at runtime.

-- ── 1. reschedule_assignment: text → calendar_slot ───────────────────────────
-- Must DROP old signature before CREATE OR REPLACE (different param types
-- create an overloaded function, not a replacement).
DROP FUNCTION IF EXISTS reschedule_assignment(uuid, int, text);

CREATE OR REPLACE FUNCTION reschedule_assignment(
  p_assignment_id uuid,
  p_day           int,
  p_slot          calendar_slot
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment chore_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_assignment FROM chore_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_assignment.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_day IS DISTINCT FROM v_assignment.calendar_day OR
     p_slot IS DISTINCT FROM v_assignment.calendar_slot THEN
    UPDATE chore_assignments
    SET calendar_day     = p_day,
        calendar_slot    = p_slot,
        reminder_sent_at = NULL
    WHERE id = p_assignment_id;
  ELSE
    UPDATE chore_assignments
    SET calendar_day  = p_day,
        calendar_slot = p_slot
    WHERE id = p_assignment_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION reschedule_assignment(uuid, int, calendar_slot) TO authenticated;

-- ── 2. send_reminder_notifications: v_slot text → calendar_slot ──────────────
-- Same signature (no params) so CREATE OR REPLACE works directly.
CREATE OR REPLACE FUNCTION send_reminder_notifications()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_time  time;
  v_current_dow int;
  v_slot        calendar_slot;
  v_slot_label  text;
  r             RECORD;
BEGIN
  v_local_time  := (now() AT TIME ZONE 'Asia/Jerusalem')::time;
  v_current_dow := EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Jerusalem'))::int;

  FOR v_slot, v_slot_label IN
    VALUES
      ('morning'::calendar_slot,   'בוקר-צהריים'),
      ('noon'::calendar_slot,      'צהריים-אחה"צ'),
      ('afternoon'::calendar_slot, 'אחה"צ-ערב')
  LOOP
    CONTINUE WHEN NOT (
      (v_slot = 'morning'   AND v_local_time >= '07:30' AND v_local_time < '08:00') OR
      (v_slot = 'noon'      AND v_local_time >= '11:30' AND v_local_time < '12:00') OR
      (v_slot = 'afternoon' AND v_local_time >= '15:30' AND v_local_time < '16:00')
    );

    FOR r IN
      SELECT
        ca.id        AS assignment_id,
        ca.user_id,
        c.title      AS chore_title,
        c.family_id
      FROM chore_assignments ca
      JOIN chores c ON c.id = ca.chore_id
      WHERE ca.reminder_enabled = true
        AND ca.reminder_sent_at IS NULL
        AND ca.status           NOT IN ('completed', 'failed')
        AND ca.archived         = false
        AND ca.calendar_slot    = v_slot
        AND ca.calendar_day     = v_current_dow
      FOR UPDATE OF ca
    LOOP
      INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
      VALUES (
        r.user_id,
        r.family_id,
        'reminder',
        'תזכורת: ' || r.chore_title,
        'המשימה שלך מתחילה בקרוב (' || v_slot_label || ')',
        r.assignment_id
      );

      UPDATE chore_assignments
      SET reminder_sent_at = now()
      WHERE id = r.assignment_id;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION send_reminder_notifications() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION send_reminder_notifications() FROM authenticated;
REVOKE EXECUTE ON FUNCTION send_reminder_notifications() FROM anon;
