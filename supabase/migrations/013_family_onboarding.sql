CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- PART 1: Extend notification_type enum
-- ============================================================
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'alias_vote_requested';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'alias_vote_resolved';

-- ============================================================
-- PART 2: Extend families table
-- ============================================================
ALTER TABLE families ADD COLUMN IF NOT EXISTS team_name  TEXT NULL;
ALTER TABLE families ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL;

-- Allow admins to update their own family row
DROP POLICY IF EXISTS "families: admins can update their own family" ON families;
CREATE POLICY "families: admins can update their own family"
  ON families FOR UPDATE
  USING (id = get_my_family_id() AND is_admin());

-- ============================================================
-- PART 3: family_invites table
-- ============================================================
CREATE TABLE IF NOT EXISTS family_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        user_role NOT NULL DEFAULT 'player',
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ NULL,
  used_by     UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE family_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family_invites: admins can view their family invites"
  ON family_invites FOR SELECT
  USING (family_id = get_my_family_id() AND is_admin());

CREATE POLICY "family_invites: admins can insert invites"
  ON family_invites FOR INSERT
  WITH CHECK (family_id = get_my_family_id() AND is_admin());

CREATE POLICY "family_invites: admins can delete their family invites"
  ON family_invites FOR DELETE
  USING (family_id = get_my_family_id() AND is_admin());

-- ============================================================
-- PART 4: RPCs — invite flow
-- ============================================================

-- generate_invite_token: admin creates a new single-use invite
CREATE OR REPLACE FUNCTION generate_invite_token(p_role user_role)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_token     text;
  v_family_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can generate invite tokens';
  END IF;
  v_family_id := get_my_family_id();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'No family found for current user';
  END IF;
  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  INSERT INTO family_invites (family_id, created_by, role, token, expires_at)
  VALUES (v_family_id, auth.uid(), p_role, v_token, now() + interval '5 hours');
  RETURN v_token;
END;
$$;

-- validate_invite_token: public — returns family info or error reason
CREATE OR REPLACE FUNCTION validate_invite_token(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_invite      family_invites%ROWTYPE;
  v_family      families%ROWTYPE;
  v_inviter_name text;
BEGIN
  SELECT * INTO v_invite FROM family_invites WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'reason', 'not_found');
  END IF;
  IF v_invite.used_at IS NOT NULL THEN
    RETURN json_build_object('valid', false, 'reason', 'used');
  END IF;
  IF v_invite.expires_at < now() THEN
    RETURN json_build_object('valid', false, 'reason', 'expired');
  END IF;
  SELECT * INTO v_family FROM families WHERE id = v_invite.family_id;
  SELECT name INTO v_inviter_name FROM profiles WHERE id = v_invite.created_by;
  RETURN json_build_object(
    'valid',       true,
    'family_name', v_family.name,
    'team_name',   v_family.team_name,
    'invited_by',  v_inviter_name
  );
END;
$$;

-- redeem_invite: called after auth.signUp succeeds; creates profile atomically
CREATE OR REPLACE FUNCTION redeem_invite(p_token text, p_name text, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_invite family_invites%ROWTYPE;
BEGIN
  SELECT * INTO v_invite FROM family_invites WHERE token = p_token FOR UPDATE;
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;
  IF v_invite.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_already_used';
  END IF;
  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;
  INSERT INTO profiles (id, family_id, name, role)
  VALUES (p_user_id, v_invite.family_id, p_name, v_invite.role);
  UPDATE family_invites SET used_at = now(), used_by = p_user_id WHERE id = v_invite.id;
END;
$$;

-- create_family_and_admin: called after auth.signUp for self-service admin signup
CREATE OR REPLACE FUNCTION create_family_and_admin(
  p_family_name text,
  p_team_name   text,
  p_admin_name  text,
  p_user_id     uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_family_id uuid;
  v_team_name text;
BEGIN
  v_team_name := NULLIF(TRIM(p_team_name), '');
  INSERT INTO families (name, team_name)
  VALUES (p_family_name, v_team_name)
  RETURNING id INTO v_family_id;

  INSERT INTO profiles (id, family_id, name, role)
  VALUES (p_user_id, v_family_id, p_admin_name, 'admin');
END;
$$;

-- ============================================================
-- PART 5: Alias voting tables
-- ============================================================
CREATE TABLE IF NOT EXISTS family_alias_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  proposed_by     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  proposed_alias  TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_at     TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS family_alias_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  UUID NOT NULL REFERENCES family_alias_proposals(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vote         BOOLEAN NOT NULL,
  voted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_id, user_id)
);

ALTER TABLE family_alias_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_alias_votes     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alias_proposals: family members can view"
  ON family_alias_proposals FOR SELECT
  USING (family_id = get_my_family_id());

CREATE POLICY "alias_votes: family members can view"
  ON family_alias_votes FOR SELECT
  USING (
    proposal_id IN (
      SELECT id FROM family_alias_proposals WHERE family_id = get_my_family_id()
    )
  );

CREATE POLICY "alias_votes: members can insert their own vote"
  ON family_alias_votes FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND proposal_id IN (
      SELECT id FROM family_alias_proposals WHERE family_id = get_my_family_id()
    )
  );

-- ============================================================
-- PART 6: Alias voting RPCs
-- ============================================================

-- check_alias_vote_outcome: internal helper — resolves early if majority reached
CREATE OR REPLACE FUNCTION check_alias_vote_outcome(p_proposal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_proposal   family_alias_proposals%ROWTYPE;
  v_total      int;
  v_yes        int;
  v_no         int;
  v_threshold  int;
BEGIN
  SELECT * INTO v_proposal FROM family_alias_proposals WHERE id = p_proposal_id;
  IF NOT FOUND OR v_proposal.status <> 'pending' THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_total FROM profiles       WHERE family_id    = v_proposal.family_id;
  SELECT COUNT(*) INTO v_yes  FROM family_alias_votes WHERE proposal_id = p_proposal_id AND vote = true;
  SELECT COUNT(*) INTO v_no   FROM family_alias_votes WHERE proposal_id = p_proposal_id AND vote = false;
  v_threshold := v_total / 2;  -- integer division: 4→2, 3→1, 2→1

  IF v_yes > v_threshold THEN
    UPDATE family_alias_proposals
      SET status = 'accepted', resolved_at = now()
      WHERE id = p_proposal_id;
    UPDATE families SET team_name = v_proposal.proposed_alias WHERE id = v_proposal.family_id;
    INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
    SELECT p.id, v_proposal.family_id, 'alias_vote_resolved',
           'כינוי המשפחה עודכן',
           'הכינוי החדש "' || v_proposal.proposed_alias || '" התקבל ברוב קולות',
           p_proposal_id
    FROM profiles p WHERE p.family_id = v_proposal.family_id;

  ELSIF v_no >= v_total - v_yes THEN  -- remaining votes can't flip result
    UPDATE family_alias_proposals
      SET status = 'rejected', resolved_at = now()
      WHERE id = p_proposal_id;
    INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
    SELECT p.id, v_proposal.family_id, 'alias_vote_resolved',
           'הצעת הכינוי נדחתה',
           'ההצעה לכינוי "' || v_proposal.proposed_alias || '" לא קיבלה רוב',
           p_proposal_id
    FROM profiles p WHERE p.family_id = v_proposal.family_id;
  END IF;
END;
$$;

-- propose_alias_change: any family member can open a vote
CREATE OR REPLACE FUNCTION propose_alias_change(p_new_alias text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_family_id   uuid;
  v_proposal_id uuid;
BEGIN
  v_family_id := get_my_family_id();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'No family found for current user';
  END IF;

  IF EXISTS (
    SELECT 1 FROM family_alias_proposals
    WHERE family_id = v_family_id AND status = 'pending' AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'active_proposal_exists';
  END IF;

  INSERT INTO family_alias_proposals (family_id, proposed_by, proposed_alias, expires_at)
  VALUES (v_family_id, auth.uid(), p_new_alias, now() + interval '1 hour')
  RETURNING id INTO v_proposal_id;

  -- Proposer auto-votes yes
  INSERT INTO family_alias_votes (proposal_id, user_id, vote)
  VALUES (v_proposal_id, auth.uid(), true);

  -- Resolve immediately for single-member family edge case
  PERFORM check_alias_vote_outcome(v_proposal_id);

  -- Notify all other family members
  INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
  SELECT p.id, v_family_id, 'alias_vote_requested',
         'הצבעה על כינוי משפחה חדש',
         'הוצע לשנות את הכינוי ל"' || p_new_alias || '"',
         v_proposal_id
  FROM profiles p WHERE p.family_id = v_family_id AND p.id <> auth.uid();
END;
$$;

-- cast_alias_vote: any family member casts their vote
CREATE OR REPLACE FUNCTION cast_alias_vote(p_proposal_id uuid, p_vote boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_proposal family_alias_proposals%ROWTYPE;
BEGIN
  SELECT * INTO v_proposal FROM family_alias_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;
  IF v_proposal.family_id <> get_my_family_id() THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;
  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal_not_pending';
  END IF;
  IF v_proposal.expires_at < now() THEN
    RAISE EXCEPTION 'proposal_expired';
  END IF;

  INSERT INTO family_alias_votes (proposal_id, user_id, vote)
  VALUES (p_proposal_id, auth.uid(), p_vote);
  -- UNIQUE constraint prevents double-voting at DB level

  PERFORM check_alias_vote_outcome(p_proposal_id);
END;
$$;

-- resolve_alias_proposal: called by client after 1-hour timer expires; idempotent
CREATE OR REPLACE FUNCTION resolve_alias_proposal(p_proposal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_proposal family_alias_proposals%ROWTYPE;
BEGIN
  SELECT * INTO v_proposal FROM family_alias_proposals WHERE id = p_proposal_id;
  IF NOT FOUND OR v_proposal.status <> 'pending' THEN RETURN; END IF;
  IF v_proposal.family_id <> get_my_family_id() THEN RETURN; END IF;
  IF v_proposal.expires_at > now() THEN
    RAISE EXCEPTION 'proposal_not_expired_yet';
  END IF;

  -- Time's up: no majority reached → reject
  UPDATE family_alias_proposals
    SET status = 'rejected', resolved_at = now()
    WHERE id = p_proposal_id;

  INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
  SELECT p.id, v_proposal.family_id, 'alias_vote_resolved',
         'הצעת הכינוי נדחתה',
         'ההצעה לכינוי "' || v_proposal.proposed_alias || '" לא קיבלה רוב',
         p_proposal_id
  FROM profiles p WHERE p.family_id = v_proposal.family_id;
END;
$$;

-- ============================================================
-- PART 7: Prevent concurrent alias proposals per family (TOCTOU guard)
-- ============================================================
-- Prevent concurrent proposals for the same family
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_pending_alias_per_family
  ON family_alias_proposals (family_id)
  WHERE status = 'pending';

-- ============================================================
-- PART 8: Storage bucket for family avatars
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'family-avatars',
  'family-avatars',
  true,
  1048576,  -- 1 MB server-side limit (post-compression)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "family-avatars: members can read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'family-avatars'
    AND (storage.foldername(name))[1] = get_my_family_id()::text
  );

CREATE POLICY "family-avatars: members can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'family-avatars'
    AND (storage.foldername(name))[1] = get_my_family_id()::text
  );

CREATE POLICY "family-avatars: members can update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'family-avatars'
    AND (storage.foldername(name))[1] = get_my_family_id()::text
  );
