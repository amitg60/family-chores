# Trust Level Advancement Design

**Goal:** Automatically advance or demote a player's trust level based on their completion approval rate, while keeping admin manual override intact.

**Architecture:** A new internal PostgreSQL function `recalculate_trust_level` is called after every completion review. It evaluates the player's last 10 reviewed completions; if approval rate crosses a threshold, it updates `profiles.trust_level` and inserts a notification. All privilege checks happen server-side in SECURITY DEFINER RPCs — no client-supplied data is trusted for authorization decisions.

**Tech Stack:** PostgreSQL (SECURITY DEFINER functions, REVOKE on internal helpers), Supabase Edge, React + TypeScript.

---

## Trust Level Ladder

| Level | Hebrew label | Privilege |
|-------|-------------|-----------|
| 1 | מתחיל | Completions require admin approval |
| 2 | מתקדם | `trust_upgrade` achievement unlocked |
| 3 | אמין | Can view own approval rate on profile |
| 4 | בכיר | Can self-approve own completions (already implemented) |
| 5 | אלוף/פה | Can approve other family members' completions |

---

## Automatic Recalculation Rules

- **Window:** the player's last 10 completions with status `approved` or `rejected` (i.e., reviewed), ordered by `completed_at DESC`.
- **Minimum data:** if fewer than 10 reviewed completions exist, no automatic change occurs (admin may still adjust manually).
- **Advance:** `approved_count / 10.0 >= 0.90` AND `current_level < 5` → `trust_level + 1`
- **Demote:** `approved_count / 10.0 < 0.70` AND `current_level > 1` → `trust_level - 1`
- **No change:** rate is between 0.70 and 0.90 (inclusive).
- Recalculation fires after every `approve_completion` and `reject_completion` call.

---

## Database Changes

### Migration: extend `notification_type` enum
Add `trust_level_changed` to the `notification_type` enum.

### New internal function: `recalculate_trust_level(p_user_id uuid)`

```sql
CREATE OR REPLACE FUNCTION recalculate_trust_level(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved   integer;
  v_total      integer;
  v_rate       numeric;
  v_level      integer;
  v_new_level  integer;
  v_family_id  uuid;
BEGIN
  -- Fetch last 10 reviewed completions
  SELECT
    COUNT(*) FILTER (WHERE status = 'approved'),
    COUNT(*)
  INTO v_approved, v_total
  FROM (
    SELECT cc.status
    FROM chore_completions cc
    JOIN chore_assignments ca ON ca.id = cc.chore_assignment_id
    WHERE cc.completed_by = p_user_id
      AND cc.status IN ('approved', 'rejected')
    ORDER BY cc.completed_at DESC
    LIMIT 10
  ) sub;

  -- Not enough data → no auto change
  IF v_total < 10 THEN
    RETURN;
  END IF;

  SELECT trust_level, family_id INTO v_level, v_family_id
  FROM profiles WHERE id = p_user_id;

  v_rate := v_approved::numeric / 10.0;

  IF v_rate >= 0.90 AND v_level < 5 THEN
    v_new_level := v_level + 1;
  ELSIF v_rate < 0.70 AND v_level > 1 THEN
    v_new_level := v_level - 1;
  ELSE
    RETURN;
  END IF;

  UPDATE profiles
  SET trust_level = v_new_level, updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
  VALUES (
    p_user_id,
    v_family_id,
    'trust_level_changed',
    CASE WHEN v_new_level > v_level THEN 'עלית ברמת האמון!' ELSE 'רמת האמון ירדה' END,
    CASE WHEN v_new_level > v_level
      THEN 'ההורים מעריכים את התייחסותך למטלות ולכן, עלית דרגה ברמת האמון'
      ELSE 'נראה כי לא התייחסת ברצינות במשימות, הפעם דרגת האמון ירדה, אנחנו יודעים שבפעם הבאה תצליח/י'
    END,
    NULL
  );
END;
$$;

-- Prevent direct client invocation — only callable from other SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION recalculate_trust_level(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION recalculate_trust_level(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION recalculate_trust_level(uuid) FROM anon;
```

### Modify `approve_completion`

After the existing approval logic, call `recalculate_trust_level(v_completion.completed_by)`.

Also extend the authorization check for level 5 peer approval:

```sql
-- Current check (level 4 self-approval):
IF v_completion.completed_by <> auth.uid() OR COALESCE(v_trust_level, 1) < 4 THEN
  RAISE EXCEPTION 'Not authorized';
END IF;

-- New check (level 4 self, level 5 peer within same family):
IF COALESCE(v_trust_level, 1) >= 5 THEN
  -- Verify same family (server-side, never trust client)
  IF v_chore.family_id <> (SELECT family_id FROM profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to approve completions outside your family';
  END IF;
ELSIF COALESCE(v_trust_level, 1) >= 4 THEN
  IF v_completion.completed_by <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to approve others completions at this trust level';
  END IF;
ELSE
  RAISE EXCEPTION 'Not authorized to approve completions';
END IF;
```

Note: `reject_completion` remains admin-only. Level 5 players can approve but not reject.

### Modify `reject_completion`

After the existing rejection logic, call `recalculate_trust_level` on the completing player. The existing RPC already does `SELECT * INTO v_completion`, so `v_completion.completed_by` is available:

```sql
-- After updating chore_assignments status:
PERFORM recalculate_trust_level(v_completion.completed_by);
```

### New RPC: `get_my_approval_rate()`

Returns the calling player's approval stats. SECURITY DEFINER; uses `auth.uid()` internally — players can only fetch their own data.

```sql
CREATE OR REPLACE FUNCTION get_my_approval_rate()
RETURNS TABLE(approved integer, rejected integer, total integer, rate numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE cc.status = 'approved')::integer,
    COUNT(*) FILTER (WHERE cc.status = 'rejected')::integer,
    COUNT(*)::integer,
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE ROUND(COUNT(*) FILTER (WHERE cc.status = 'approved')::numeric / COUNT(*) * 100, 1)
    END
  FROM chore_completions cc
  WHERE cc.completed_by = auth.uid()
    AND cc.status IN ('approved', 'rejected');
END;
$$;
```

---

## TypeScript Changes

### `src/types/database.ts`

Add `'trust_level_changed'` to the `NotificationType` union.

### New hook: `src/hooks/useApprovalRate.ts`

Calls `get_my_approval_rate()` RPC. Returns `{ approved, rejected, total, rate, loading }`. Only mounted when `trust_level >= 3`.

---

## UI Changes

### `src/pages/player/profile/ProfilePage.tsx`

1. **Trust level label:** Display the Hebrew label next to the level number.
   ```
   const TRUST_LABELS = ['', 'מתחיל', 'מתקדם', 'אמין', 'בכיר', 'אלוף/פה']
   ```

2. **Approval rate card (trust_level ≥ 3 only):** Rendered below the trust bar.
   - Shows: "אחוז אישורים: X%" with approved/total counts.
   - Calls `useApprovalRate` hook.
   - Not rendered at all for levels 1–2 (no hook mounted, no data fetched).

### `src/pages/admin/players/PlayersPage.tsx`

No structural changes. The existing `set_trust_level` RPC and +/− buttons stay as-is.

---

## Security Summary

| Concern | Mitigation |
|---------|-----------|
| Client calling `recalculate_trust_level` directly | `REVOKE EXECUTE` from all client roles |
| Level 5 approving cross-family completions | Family membership re-checked server-side from `profiles` table |
| Player viewing another player's approval rate | `get_my_approval_rate()` uses `auth.uid()` internally; no user-supplied ID parameter |
| Trust level written from client | Impossible — only `set_trust_level` (admin-only) and `recalculate_trust_level` (internal) can write `trust_level` |
| Notification insertion in internal function | Runs as function owner (postgres) via SECURITY DEFINER; RLS on notifications does not block it |
