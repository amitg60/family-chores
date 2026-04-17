-- Fix: set auth.uid() context so is_admin() resolves correctly when called via service role

CREATE OR REPLACE FUNCTION email_approve_completion(
  p_completion_id uuid,
  p_admin_id      uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_admin_id::text)::text, true);
  PERFORM approve_completion(p_completion_id);
  INSERT INTO email_action_log (completion_id, admin_id, action, source)
  VALUES (p_completion_id, p_admin_id, 'approve', 'email');
END;
$$;

CREATE OR REPLACE FUNCTION email_reject_completion(
  p_completion_id uuid,
  p_admin_id      uuid,
  p_reason        text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_admin_id::text)::text, true);
  PERFORM reject_completion(p_completion_id, p_reason);
  INSERT INTO email_action_log (completion_id, admin_id, action, source)
  VALUES (p_completion_id, p_admin_id, 'reject', 'email');
END;
$$;

REVOKE EXECUTE ON FUNCTION email_approve_completion(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION email_reject_completion(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION email_approve_completion(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION email_reject_completion(uuid, uuid, text) TO service_role;
