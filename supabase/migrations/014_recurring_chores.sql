-- ============================================================
-- PART 1: Replace is_recurring with recurrence_type on chores
-- ============================================================
ALTER TABLE chores
  ADD COLUMN recurrence_type TEXT NOT NULL DEFAULT 'none'
    CHECK (recurrence_type IN ('none', 'weekly', 'daily', 'monthly'));

UPDATE chores SET recurrence_type = 'weekly' WHERE is_recurring = true;

ALTER TABLE chores DROP COLUMN is_recurring;

-- ============================================================
-- PART 2: chore_schedule table
-- ============================================================
CREATE TABLE IF NOT EXISTS chore_schedule (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chore_id     UUID NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  day_of_week  INTEGER CHECK (day_of_week BETWEEN 0 AND 6), -- NULL = weekly/monthly
  assigned_to  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (chore_id, assigned_to, day_of_week)
);

ALTER TABLE chore_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chore_schedule: family members can read"
  ON chore_schedule FOR SELECT
  USING (chore_id IN (
    SELECT id FROM chores WHERE family_id = get_my_family_id()
  ));

CREATE POLICY "chore_schedule: admins can write"
  ON chore_schedule FOR ALL
  USING (
    chore_id IN (SELECT id FROM chores WHERE family_id = get_my_family_id())
    AND is_admin()
  );

-- ============================================================
-- PART 3: Unique constraint on chore_assignments
-- Prevents same player getting same chore/day twice,
-- but allows multiple players on the same chore/day.
-- ============================================================
ALTER TABLE chore_assignments
  ADD CONSTRAINT chore_assignments_unique_player_slot
  UNIQUE NULLS NOT DISTINCT (chore_id, user_id, week_start, calendar_day);

-- ============================================================
-- PART 4: populate_weekly_assignments RPC
-- ============================================================
CREATE OR REPLACE FUNCTION populate_weekly_assignments(p_week_start date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_family_id uuid;
  v_sched     RECORD;
BEGIN
  v_family_id := get_my_family_id();
  IF v_family_id IS NULL THEN RAISE EXCEPTION 'no_family'; END IF;

  -- Weekly: one assignment per scheduled player (day_of_week IS NULL)
  FOR v_sched IN
    SELECT cs.assigned_to, cs.chore_id
    FROM chore_schedule cs
    JOIN chores c ON c.id = cs.chore_id
    WHERE c.family_id = v_family_id
      AND c.recurrence_type = 'weekly'
      AND c.status = 'active'
      AND cs.day_of_week IS NULL
  LOOP
    INSERT INTO chore_assignments (chore_id, user_id, week_start)
    VALUES (v_sched.chore_id, v_sched.assigned_to, p_week_start)
    ON CONFLICT ON CONSTRAINT chore_assignments_unique_player_slot DO NOTHING;
  END LOOP;

  -- Daily: one assignment per scheduled player per day
  FOR v_sched IN
    SELECT cs.assigned_to, cs.chore_id, cs.day_of_week
    FROM chore_schedule cs
    JOIN chores c ON c.id = cs.chore_id
    WHERE c.family_id = v_family_id
      AND c.recurrence_type = 'daily'
      AND c.status = 'active'
      AND cs.day_of_week IS NOT NULL
  LOOP
    INSERT INTO chore_assignments (chore_id, user_id, week_start, calendar_day)
    VALUES (v_sched.chore_id, v_sched.assigned_to, p_week_start, v_sched.day_of_week)
    ON CONFLICT ON CONSTRAINT chore_assignments_unique_player_slot DO NOTHING;
  END LOOP;

  -- Monthly: label only, no auto-creation
END;
$$;
