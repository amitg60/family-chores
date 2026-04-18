-- ============================================================
-- PART 1: is_pool_visible on chores
-- Recurring tasks always TRUE. Non-recurring flips to FALSE
-- when claimed, back to TRUE when assignment is deleted/failed.
-- ============================================================
ALTER TABLE chores
  ADD COLUMN is_pool_visible BOOLEAN NOT NULL DEFAULT TRUE;

-- Existing non-recurring chores that are already claimed should
-- be marked not visible (assigned_to IS NOT NULL).
UPDATE chores
  SET is_pool_visible = FALSE
  WHERE recurrence_type = 'none'
    AND assigned_to IS NOT NULL;

-- Ensure recurring chores are explicitly TRUE (not just default).
UPDATE chores
  SET is_pool_visible = TRUE
  WHERE recurrence_type != 'none';

-- ============================================================
-- PART 2: assigned_by on chore_assignments
-- Tracks whether an admin or the player created the assignment.
-- ============================================================
ALTER TABLE chore_assignments
  ADD COLUMN assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- ============================================================
-- PART 3: Replace unique constraint to allow same-day multi-slot
-- Old: (chore_id, user_id, week_start, calendar_day)
-- New: (chore_id, user_id, week_start, calendar_day, calendar_slot)
-- This lets a player hold the same chore in two different slots
-- on the same day, while still blocking exact duplicates.
-- ============================================================
ALTER TABLE chore_assignments
  DROP CONSTRAINT IF EXISTS chore_assignments_unique_player_slot;

ALTER TABLE chore_assignments
  ADD CONSTRAINT chore_assignments_unique_player_slot
  UNIQUE NULLS NOT DISTINCT (chore_id, user_id, week_start, calendar_day, calendar_slot);

-- ============================================================
-- PART 4: Drop player INSERT policy on chore_assignments
-- All inserts now go through Edge Functions (service_role).
-- ============================================================
DROP POLICY IF EXISTS "assignments: players can insert for themselves; admins can insert for anyone"
  ON chore_assignments;

-- ============================================================
-- PART 5: Player UPDATE guard trigger
-- Prevents players from modifying protected fields even if an
-- RLS WITH CHECK misconfiguration occurs (defence in depth).
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_player_assignment_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN
    IF (OLD.chore_id    IS DISTINCT FROM NEW.chore_id)    OR
       (OLD.user_id     IS DISTINCT FROM NEW.user_id)     OR
       (OLD.week_start  IS DISTINCT FROM NEW.week_start)  OR
       (OLD.status      IS DISTINCT FROM NEW.status)      OR
       (OLD.assigned_by IS DISTINCT FROM NEW.assigned_by) OR
       (OLD.archived    IS DISTINCT FROM NEW.archived)
    THEN
      RAISE EXCEPTION 'FORBIDDEN_FIELD_UPDATE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chore_assignments_player_update_guard
  BEFORE UPDATE ON chore_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_player_assignment_update();
