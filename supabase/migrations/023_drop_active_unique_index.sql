-- Drop partial unique index that blocked assigning the same recurring chore
-- to multiple slots in the same week. The correct constraint is
-- chore_assignments_unique_player_slot (chore_id, user_id, week_start, calendar_day, calendar_slot).
DROP INDEX IF EXISTS uq_chore_assignment_active;
