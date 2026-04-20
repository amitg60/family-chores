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

**Admin override interaction — sharp behavioral rule:** If an admin manually sets a player's trust level via `set_trust_level`, that value is **not protected**. The very next completion review (approve or reject, by anyone) triggers `recalculate_trust_level`, which will immediately overwrite the admin's value if the last-10 window satisfies a threshold. For example: admin raises a player to level 3 at 17:00; a completion is approved at 17:05; the window shows 9/10 approved → player is auto-raised to level 4, overriding the admin's intent. There is no lock mechanism by design — approval rate is the authoritative signal. Admins who need a level to persist must re-apply it after each relevant review, or accept that the automatic rule governs.

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

Replace the existing non-admin authorization block with four flat, sequentially evaluated rules. Each rule is a standalone guard that raises immediately if violated. Reading top-to-bottom answers: "can this caller approve this completion?"

```sql
-- Replaces the existing non-admin auth block entirely.
-- Four flat rules, evaluated in order. Each raises on violation.
IF NOT is_admin() THEN
  DECLARE
    v_caller_family uuid;
    v_caller_trust  integer;
  BEGIN
    -- Rule 1: caller must have a profile.
    SELECT family_id, trust_level INTO v_caller_family, v_caller_trust
    FROM profiles WHERE id = auth.uid();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not authorized: caller has no profile';
    END IF;

    -- Rule 2: caller's trust level must be at least 4.
    --   (Levels 1–3 cannot approve any completion.)
    IF COALESCE(v_caller_trust, 1) < 4 THEN
      RAISE EXCEPTION 'Not authorized: trust level too low to approve completions';
    END IF;

    -- Rule 3: caller must be in the same family as the chore.
    --   (Applies to both level 4 and level 5.)
    IF v_caller_family IS NULL OR v_caller_family <> v_chore.family_id THEN
      RAISE EXCEPTION 'Not authorized: approver is not in the same family as this chore';
    END IF;

    -- Rule 4: level 4 may only self-approve; level 5 may approve anyone in the family.
    IF v_caller_trust = 4 AND v_completion.completed_by <> auth.uid() THEN
      RAISE EXCEPTION 'Not authorized: trust level 4 may only approve own completions';
    END IF;
    -- (If v_caller_trust >= 5 and rules 1–3 pass, no further restriction applies.)
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

Returns the calling player's **all-time** approval stats for display purposes on the profile page. This intentionally differs from the recalculation window:

- **Recalculation** uses the last 10 reviewed completions — a rolling window that keeps trust level responsive to recent behavior.
- **Display** uses all-time totals — gives the player a full picture of their track record, not just the most recent 10. Showing "47 approved out of 52 total" is more motivating and informative than showing the 10-item window that drives promotion.

The two values can diverge: a player may have a 90% all-time rate but be stuck at 8/10 in the recent window (and thus not promoted yet). This is expected and correct behavior.

`SECURITY DEFINER`; uses `auth.uid()` internally so players can only ever fetch their own data. Returns an empty result set (not an error) if the caller is unauthenticated or has no profile, to avoid leaking information.

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
| Notification insert bypassing RLS | Intentional and consistent — every notification insert in this codebase (`approve_completion`, `reject_completion`, trigger functions) runs inside a SECURITY DEFINER context as the postgres owner. This is the established pattern: server-side RPCs are trusted to insert notifications on behalf of users; the RLS policy on `notifications` governs only direct client reads/writes, not internal server writes. `recalculate_trust_level` follows the same pattern deliberately. |
| Admin manual override being auto-overridden | Sharp behavioral rule — see "Admin override interaction" section above. Any completion review immediately re-runs recalculation and may overwrite an admin's manual value. No lock mechanism exists by design. |
