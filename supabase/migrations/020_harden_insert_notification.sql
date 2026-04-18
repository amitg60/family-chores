-- ============================================================
-- Harden insert_notification SECURITY DEFINER function
-- by pinning search_path (same hardening as migration 005
-- applied to is_admin() and get_my_family_id()).
-- insert_notification was defined later (migration 012) and missed.
-- ============================================================
CREATE OR REPLACE FUNCTION insert_notification(
  p_user_id           uuid,
  p_family_id         uuid,
  p_type              notification_type,
  p_title_he          text,
  p_body_he           text,
  p_related_entity_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
  VALUES (p_user_id, p_family_id, p_type, p_title_he, p_body_he, p_related_entity_id);
END;
$$;
