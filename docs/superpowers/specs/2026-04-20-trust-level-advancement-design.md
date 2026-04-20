# Trust Level Advancement Design

**Goal:** Automatically advance or demote a player's trust level based on their completion approval rate, while keeping admin manual override intact.

**Architecture:** A new internal PostgreSQL function `recalculate_trust_level` is called after every completion review. It evaluates the player's last 10 reviewed completions (status `approved` or `rejected`); if approval rate crosses a threshold, it updates `profiles.trust_level` and inserts a notification. All privilege checks happen server-side in SECURITY DEFINER RPCs — no client-supplied data is trusted for authorization decisions.

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

- **Window:** the player's last 10 completions with status `approved` or `rejected` (i.e., reviewed — pending completions are excluded), ordered by `completed_at DESC`.
- **Minimum data:** if fewer than 10 reviewed completions exist, no automatic change occurs. Admin may still adjust manually.
- **Advance:** `approved_count >= 9` (i.e., rate ≥ 0.90, meaning exactly 90% also triggers promotion) AND `current_level < 5` → `trust_level + 1`.
- **Demote:** `approved_count < 7` (i.e., rate < 0.70, meaning exactly 70% does NOT trigger demotion) AND `current_level > 1` → `trust_level - 1`.
- **No change:** `approved_count` is 7, 8, or 9 out of 10 (70% ≤ rate < 90%).
- Recalculation fires after every `approve_completion` and `reject_completion` call.

**Admin override interaction:** If an admin manually sets a player's trust level via `set_trust_level`, the next automatic recalculation (triggered by the next completion review) may override it if the approval rate crosses a threshold. There is no lock-out mechanism — the automatic rule always applies after every review. Admins who want a level to persist regardless of approval rate must continue to re-apply it manually.

---

## Database Changes

### Migration: extend `notification_type` enum

Add `trust_level_changed` to the `notification_type` enum:

```sql
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trust_level_changed';
```

### New internal function: `recalculate_trust_level(p_user_id uuid)`

This function is `SECURITY DEFINER` (runs as the Postgres function owner, bypassing RLS). This is intentional: it writes `profiles.trust_level` and inserts a notification row as a trusted server-side operation — the same pattern used by `approve_completion` and `reject_completion`. `EXECUTE` is revoked from all client roles so it cannot be called directly from the frontend.

```sql
CREATE OR REPLACE FUNCTION recalculate_trust_level(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved   integer;
  v_total      integer;
  v_level      integer;
  v_new_level  integer;
  v_family_id  uuid;
BEGIN
  -- Guard: profile must exist
  SELECT trust_level, family_id INTO v_level, v_family_id
  FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Count last 10 reviewed (approved or rejected) completions
  SELECT
    COUNT(*) FILTER (WHERE status = 'approved'),
    COUNT(*)
  INTO v_approved, v_total
  FROM (
    SELECT cc.status
    FROM chore_completions cc
    WHERE cc.completed_by = p_user_id
      AND cc.status IN ('approved', 'rejected')
    ORDER BY cc.completed_at DESC
    LIMIT 10
  ) sub;

  -- Not enough reviewed completions → no auto change
  IF v_total < 10 THEN
    RETURN;
  END IF;

  -- approved_count >= 9 out of 10 → promote (≥90%, boundary included)
  -- approved_count < 7 out of 10  → demote  (<70%, boundary excluded)
  IF v_approved >= 9 AND v_level < 5 THEN
    v_new_level := v_level + 1;
  ELSIF v_approved < 7 AND v_level > 1 THEN
    v_new_level := v_level - 1;
  ELSE
    RETURN;
  END IF;

  UPDATE profiles
  SET trust_level = v_new_level, updated_at = now()
  WHERE id = p_user_id;

  -- Notification insert runs as SECURITY DEFINER (postgres owner), bypassing RLS intentionally.
  -- This mirrors the pattern used in approve_completion and reject_completion.
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

Replace the existing non-admin authorization block with a unified check that verifies same-family membership for all non-admin approval paths:

```sql
-- Replaces the existing non-admin auth block entirely:
IF NOT is_admin() THEN
  DECLARE
    v_caller_family uuid;
    v_caller_trust  integer;
  BEGIN
    -- Always fetch caller's profile server-side; never trust client input
    SELECT family_id, trust_level INTO v_caller_family, v_caller_trust
    FROM profiles WHERE id = auth.uid();

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Caller profile not found';
    END IF;

    -- All non-admin approvals require same-family membership
    IF v_caller_family IS NULL OR v_caller_family <> v_chore.family_id THEN
      RAISE EXCEPTION 'Not authorized to approve completions outside your family';
    END IF;

    -- Level 4: self-approval only
    -- Level 5: can approve any family member
    IF COALESCE(v_caller_trust, 1) >= 5 THEN
      NULL; -- family check above is sufficient for level 5
    ELSIF COALESCE(v_caller_trust, 1) >= 4 THEN
      IF v_completion.completed_by <> auth.uid() THEN
        RAISE EXCEPTION 'Not authorized to approve other players completions at trust level 4';
      END IF;
    ELSE
      RAISE EXCEPTION 'Not authorized to approve completions';
    END IF;
  END;
END IF;
```

After the coin award and assignment update, call:

```sql
PERFORM recalculate_trust_level(v_completion.completed_by);
```

Note: `reject_completion` remains admin-only. Level 5 players can approve but cannot reject.

### Modify `reject_completion`

After updating the completion and assignment status, call `recalculate_trust_level`. The existing RPC already does `SELECT * INTO v_completion` so `v_completion.completed_by` is available:

```sql
-- After updating chore_assignments status:
PERFORM recalculate_trust_level(v_completion.completed_by);
```

### New RPC: `get_my_approval_rate()`

Returns the calling player's all-time approval stats. `SECURITY DEFINER`; uses `auth.uid()` internally so players can only ever fetch their own data. Returns an empty result set (not an error) if the caller is unauthenticated or has no profile, to avoid leaking information.

```sql
CREATE OR REPLACE FUNCTION get_my_approval_rate()
RETURNS TABLE(approved integer, rejected integer, total integer, rate numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: unauthenticated or missing profile → return empty result set
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE cc.status = 'approved')::integer  AS approved,
    COUNT(*) FILTER (WHERE cc.status = 'rejected')::integer  AS rejected,
    COUNT(*)::integer                                         AS total,
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE ROUND(
           COUNT(*) FILTER (WHERE cc.status = 'approved')::numeric / COUNT(*) * 100,
           1
         )
    END                                                       AS rate
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

Calls `get_my_approval_rate()` RPC. Returns `{ approved, rejected, total, rate, loading }`. Only mounted when `trust_level >= 3` (the parent component gates the render).

---

## UI Changes

### `src/pages/player/profile/ProfilePage.tsx`

1. **Trust level label:** Display the Hebrew label next to the level number.
   ```ts
   const TRUST_LABELS = ['', 'מתחיל', 'מתקדם', 'אמין', 'בכיר', 'אלוף/פה']
   ```

2. **Approval rate card (trust_level ≥ 3 only):** Rendered below the trust bar. Shows "אחוז אישורים: X%" with approved/total counts. Not rendered at levels 1–2 (hook is not mounted, no data fetched).

### `src/pages/admin/players/PlayersPage.tsx`

No structural changes. The existing `set_trust_level` RPC and +/− buttons stay as-is.

---

## Security Summary

| Concern | Mitigation |
|---------|-----------|
| Client calling `recalculate_trust_level` directly | `REVOKE EXECUTE` from all client roles (`PUBLIC`, `authenticated`, `anon`) |
| Level 5 approving cross-family completions | All non-admin approval paths perform an explicit same-family check against `profiles` server-side |
| Level 4 approving other players | Explicit `completed_by = auth.uid()` check in the level-4 branch |
| Missing profile for approver | `IF NOT FOUND` guard raises an exception before any privilege is granted |
| Missing profile in `recalculate_trust_level` | `IF NOT FOUND THEN RETURN` — silently exits without writing any data |
| Player viewing another player's approval rate | `get_my_approval_rate()` uses `auth.uid()` only; no user-supplied ID |
| Unauthenticated call to `get_my_approval_rate()` | Explicit `auth.uid() IS NULL` guard returns empty result set |
| Trust level written from client | Impossible — only `set_trust_level` (admin-only RPC) and `recalculate_trust_level` (internal, revoked) can write `trust_level` |
| Notification insert bypassing RLS | Intentional — function runs as postgres owner (SECURITY DEFINER), same pattern as all other notification inserts in this codebase |
| Admin manual override being auto-overridden | Documented behavior: auto-recalculation fires after every review regardless of how the current level was set. No lock mechanism exists by design. |
