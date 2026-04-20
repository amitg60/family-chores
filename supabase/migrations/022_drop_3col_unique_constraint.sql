-- Drop the undocumented 3-column unique constraint (chore_id, user_id, week_start)
-- that prevents assigning the same recurring chore to multiple slots in a week.
-- Migration 021 added the correct 5-column constraint but missed this one.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT pc.conname INTO cname
  FROM pg_constraint pc
  JOIN pg_class rel ON rel.oid = pc.conrelid
  WHERE rel.relname = 'chore_assignments'
    AND pc.contype = 'u'
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname)
      FROM pg_attribute a
      WHERE a.attrelid = pc.conrelid
        AND a.attnum = ANY(pc.conkey)
    ) = ARRAY['chore_id', 'user_id', 'week_start']
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE chore_assignments DROP CONSTRAINT ' || quote_ident(cname);
    RAISE NOTICE 'Dropped constraint: %', cname;
  END IF;
END;
$$;
