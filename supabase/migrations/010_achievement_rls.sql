-- Players can insert their own achievement records
CREATE POLICY "player_achievements: players can earn"
  ON player_achievements FOR INSERT
  WITH CHECK (user_id = auth.uid());
