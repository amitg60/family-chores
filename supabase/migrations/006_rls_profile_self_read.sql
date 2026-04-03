-- Allow users to always read their own profile, even before joining a family.
-- The existing "family members can view each other" policy uses family_id = get_my_family_id(),
-- which evaluates to NULL = NULL (FALSE) when family_id is NULL — blocking new/unfamilied users
-- from reading their own profile and causing an infinite redirect loop after login.
CREATE POLICY "profiles: users can view their own profile"
  ON profiles FOR SELECT
  USING (id = auth.uid());
