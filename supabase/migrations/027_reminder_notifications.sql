-- supabase/migrations/027_reminder_notifications.sql

-- ── 1. chore_assignments: reminder delivery timestamp ──────────────────────
ALTER TABLE chore_assignments
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ NULL;

-- ── 2. toggle_reminder(uuid) ───────────────────────────────────────────────
-- Callable by authenticated users. Validates ownership, toggles reminder_enabled.
-- On enable: resets reminder_sent_at = NULL so cron fires again.
-- On disable: leaves reminder_sent_at unchanged.
CREATE OR REPLACE FUNCTION toggle_reminder(p_assignment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment chore_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_assignment FROM chore_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_assignment.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_assignment.reminder_enabled THEN
    -- Disabling: leave reminder_sent_at unchanged
    UPDATE chore_assignments
    SET reminder_enabled = false
    WHERE id = p_assignment_id;
  ELSE
    -- Enabling: reset reminder_sent_at so cron fires for current slot
    UPDATE chore_assignments
    SET reminder_enabled  = true,
        reminder_sent_at  = NULL
    WHERE id = p_assignment_id;
  END IF;
END;
$$;

-- ── 3. reschedule_assignment(uuid, int, text) ──────────────────────────────
-- Callable by authenticated users. Validates ownership, updates slot/day.
-- Re-arms reminder (reminder_sent_at = NULL) only when slot or day actually changes.
-- NULL p_day / p_slot = unpin. Unpin also resets reminder_sent_at (intentional:
-- ensures fresh reminder when player re-pins later).
CREATE OR REPLACE FUNCTION reschedule_assignment(
  p_assignment_id uuid,
  p_day           int,
  p_slot          text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment chore_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v_assignment FROM chore_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_assignment.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_day IS DISTINCT FROM v_assignment.calendar_day OR
     p_slot IS DISTINCT FROM v_assignment.calendar_slot THEN
    -- Slot or day changed: silently re-arm reminder
    UPDATE chore_assignments
    SET calendar_day     = p_day,
        calendar_slot    = p_slot,
        reminder_sent_at = NULL
    WHERE id = p_assignment_id;
  ELSE
    -- No change to slot/day: don't touch reminder_sent_at
    UPDATE chore_assignments
    SET calendar_day  = p_day,
        calendar_slot = p_slot
    WHERE id = p_assignment_id;
  END IF;
END;
$$;

-- ── 4. send_reminder_notifications() ──────────────────────────────────────
-- Called by pg_cron every 30 min. SECURITY DEFINER (postgres owner) bypasses
-- RLS — intentional, never callable by clients (REVOKE'd below).
-- FOR UPDATE OF ca serializes against concurrent reschedule_assignment calls.
CREATE OR REPLACE FUNCTION send_reminder_notifications()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_time  time;
  v_current_dow int;
  v_slot        text;
  v_slot_label  text;
  r             RECORD;
BEGIN
  v_local_time  := (now() AT TIME ZONE 'Asia/Jerusalem')::time;
  v_current_dow := EXTRACT(DOW FROM (now() AT TIME ZONE 'Asia/Jerusalem'))::int;

  FOR v_slot, v_slot_label IN
    VALUES ('morning','בוקר-צהריים'), ('noon','צהריים-אחה"צ'), ('afternoon','אחה"צ-ערב')
  LOOP
    -- Skip this run if current Israel time is outside the slot's 30-min window
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

-- ── 5. Revoke client access to send_reminder_notifications ────────────────
REVOKE EXECUTE ON FUNCTION send_reminder_notifications() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION send_reminder_notifications() FROM authenticated;
REVOKE EXECUTE ON FUNCTION send_reminder_notifications() FROM anon;

-- ── 6. pg_cron schedule (idempotent) ──────────────────────────────────────
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'reminder-notifications';
SELECT cron.schedule(
  'reminder-notifications',
  '*/30 * * * *',
  'SELECT send_reminder_notifications()'
);
