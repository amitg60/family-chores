-- Allow players to delete their own pending assignments.
-- Used when removing a recurring chore slot from the calendar.
CREATE POLICY "assignments: players can delete their own pending"
  ON chore_assignments FOR DELETE
  USING (user_id = auth.uid() AND status = 'pending');
