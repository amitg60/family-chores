-- supabase/migrations/016_email_action_log.sql

-- Audit table: source of truth for email-triggered actions
CREATE TABLE email_action_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id uuid        NOT NULL REFERENCES chore_completions(id),
  admin_id      uuid        NOT NULL REFERENCES profiles(id),
  action        text        NOT NULL CHECK (action IN ('approve', 'reject')),
  source        text        NOT NULL DEFAULT 'email',
  actioned_at   timestamptz NOT NULL DEFAULT now()
);

-- Fast lookups by completion
CREATE INDEX email_action_log_completion_id_idx ON email_action_log (completion_id);

-- Admins can only read their own rows; service role handles inserts via wrapper functions
ALTER TABLE email_action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read own rows"
  ON email_action_log FOR SELECT
  USING (admin_id = auth.uid());

-- Wrapper: approve + audit in a single Postgres transaction
CREATE OR REPLACE FUNCTION email_approve_completion(
  p_completion_id uuid,
  p_admin_id      uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM approve_completion(p_completion_id);
  INSERT INTO email_action_log (completion_id, admin_id, action, source)
  VALUES (p_completion_id, p_admin_id, 'approve', 'email');
END;
$$;

-- Wrapper: reject + audit in a single Postgres transaction
CREATE OR REPLACE FUNCTION email_reject_completion(
  p_completion_id uuid,
  p_admin_id      uuid,
  p_reason        text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM reject_completion(p_completion_id, p_reason);
  INSERT INTO email_action_log (completion_id, admin_id, action, source)
  VALUES (p_completion_id, p_admin_id, 'reject', 'email');
END;
$$;
