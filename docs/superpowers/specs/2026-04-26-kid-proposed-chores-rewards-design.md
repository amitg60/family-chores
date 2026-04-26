# Kid-Proposed Chores & Rewards — Design Spec
**Date:** 2026-04-26
**Status:** Approved for implementation planning

---

## Overview

Players (kids) can propose new chores and rewards directly from the chore pool and reward store pages. Proposals enter `pending_approval` status and appear in a "My Proposals" section on the same page. Admins see proposals in their existing approval queue and can approve or reject with an optional reason. Players are notified of the outcome; admins are notified (in-app + email) when a proposal is submitted.

The DB schema, RLS, and admin approval UI are already in place. This feature adds the player-facing submission forms, the "My Proposals" tracking sections, rejection reason storage, and the admin notification path.

---

## 1. Goals

- Players can propose chores from the chore pool page ("הצע משימה")
- Players can propose rewards from the reward store page ("הצע מתנה חדשה")
- Players see their own pending and rejected proposals on the respective page
- Rejected proposals show the admin's reason (if provided); player dismisses them with "אישור" → row deleted
- Admins see an optional reason dialog when rejecting a proposal (proposals only — not regular archive)
- Admins get in-app notification + email when a player submits a proposal
- Players get existing `proposal_resolved` in-app notification (already implemented) with rejection reason in body
- Admins can edit approved proposals without notifying the player (existing edit flow, unchanged)

---

## 2. Architecture

```
Player submits proposal
  → Direct INSERT (chores/rewards, status='pending_approval', proposed_by=auth.uid())
  → RLS validates: proposed_by = auth.uid(), status = 'pending_approval'
  → DB trigger fires → inserts proposal_submitted notification for each admin
  → DB webhook fires → notify-admin-proposal Edge Function → Resend email to admins

Admin rejects proposal
  → UPDATE chores/rewards SET status='archived', proposal_rejection_reason=<reason>
  → Existing notify_proposal_resolved trigger fires → player gets proposal_resolved notification
      (updated to include rejection reason in body)

Player dismisses rejected proposal
  → dismiss_rejected_proposal('chore'|'reward', id) RPC
  → Validates proposed_by = auth.uid() AND status = 'archived'
  → DELETE row
```

---

## 3. DB Migration — `031_kid_proposals.sql`

### 3.1 New columns

```sql
ALTER TABLE chores  ADD COLUMN IF NOT EXISTS proposal_rejection_reason TEXT NULL;
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS proposal_rejection_reason TEXT NULL;
```

Populated only when admin rejects a player proposal. Admin-created rows and regular archive actions leave it NULL.

### 3.2 New notification type

```sql
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'proposal_submitted';
```

### 3.3 Trigger — `notify_chore_proposal_submitted()`

Fires AFTER INSERT on `chores` WHERE `proposed_by IS NOT NULL`. Looks up all admin profiles in `NEW.family_id`, inserts one `proposal_submitted` notification per admin:

- `title_he`: `'הצעת משימה חדשה'`
- `body_he`: `'"' || NEW.title || '" הוצע על ידי ' || <proposer_name>`
- `related_entity_id`: `NEW.id`

### 3.4 Trigger — `notify_reward_proposal_submitted()`

Mirror of 3.3 on the `rewards` table:

- `title_he`: `'הצעת פרס חדש'`
- `body_he`: `'"' || NEW.title || '" הוצע על ידי ' || <proposer_name>`
- `related_entity_id`: `NEW.id`

### 3.5 Update `notify_proposal_resolved` (migration 012)

Replace with `CREATE OR REPLACE FUNCTION notify_proposal_resolved()`. The rejection branch updates the body to include the reason if present:

```sql
IF NEW.status = 'archived' THEN
  v_body_he := '"' || NEW.title || '" נדחתה על ידי המנהל'
               || CASE WHEN NEW.proposal_rejection_reason IS NOT NULL
                       THEN ': ' || NEW.proposal_rejection_reason
                       ELSE '' END;
END IF;
```

The trigger on `chores` already exists (`trg_notify_proposal_resolved`). The same function also needs to cover `rewards` — add an identical trigger on the `rewards` table (`trg_notify_reward_proposal_resolved`).

### 3.6 RPC — `dismiss_rejected_proposal`

```sql
CREATE OR REPLACE FUNCTION dismiss_rejected_proposal(
  p_entity_type TEXT,
  p_entity_id   UUID
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_entity_type = 'chore' THEN
    DELETE FROM chores
    WHERE id = p_entity_id
      AND proposed_by = auth.uid()
      AND status = 'archived';
  ELSIF p_entity_type = 'reward' THEN
    DELETE FROM rewards
    WHERE id = p_entity_id
      AND proposed_by = auth.uid()
      AND status = 'archived';
  ELSE
    RAISE EXCEPTION 'Invalid entity type: %', p_entity_type;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found or not authorized';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION dismiss_rejected_proposal(TEXT, UUID) TO authenticated;
```

---

## 4. Edge Function — `notify-admin-proposal`

New function. Triggered by two DB webhooks: INSERT on `chores` and INSERT on `rewards`.

**Auth:** `x-webhook-secret` header validated against `WEBHOOK_SECRET` env var (same pattern as `notify-admin-completion`).

**Logic:**
1. If `NEW.proposed_by IS NULL` → skip silently (admin-created, not a proposal)
2. Look up proposer name from `profiles`
3. Look up all admin profiles in `NEW.family_id`
4. For each admin: fetch auth email, send Resend email

**Email content:**

- Subject: `'הצעה חדשה ממתינה לאישורך — ' || proposer_name`
- Body (Hebrew RTL HTML): proposer name + title + link to admin chores/rewards page

**Env vars required:** `WEBHOOK_SECRET`, `RESEND_API_KEY`, `FROM_EMAIL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`

No action buttons needed (unlike completion emails) — admin approves/rejects from the dashboard.

---

## 5. Player UI

### 5.1 ChorePoolPage.tsx

**Proposal button:** "הצע משימה" button added to the page header area. Opens a dialog:

- Fields: title (required), description (optional textarea), coin_value (required, integer ≥ 1), difficulty (radio: easy / medium / hard, default easy)
- Submit → `supabase.from('chores').insert({ title, description, coin_value, difficulty, status: 'pending_approval', proposed_by: user.id, family_id })`
- On success: close dialog, refetch proposals section
- On error: show inline error, keep dialog open

**"ההצעות שלי" section:** Shown below the pool. Queries:
```
chores WHERE proposed_by = auth.uid()
  AND family_id = <user.family_id>
  AND status IN ('pending_approval', 'archived')
ORDER BY created_at DESC
```

Card states:
- **Pending** — title, coin value, difficulty badge, badge "ממתין לאישור" (muted). No action.
- **Rejected** — title, badge "נדחה" (destructive). Clickable → opens confirmation dialog:
  - If `proposal_rejection_reason` is set: "הצעתך נדחתה על ידי המנהל: [reason]"
  - If null: "הצעתך נדחתה על ידי המנהל"
  - Single button "אישור" → calls `dismiss_rejected_proposal('chore', id)` → removes card from list
  - On RPC error: show toast, close dialog (card stays visible)

Section hidden if player has no proposals.

### 5.2 RewardStorePage.tsx

**Proposal button:** "הצע מתנה חדשה" button added to the store header. Opens a dialog:

- Fields: title (required), description (optional textarea), coin_cost (required, integer ≥ 1)
- Submit → `supabase.from('rewards').insert({ title, description, coin_cost, status: 'pending_approval', proposed_by: user.id, family_id })`
- Same success/error handling as chore form

**"ההצעות שלי" section:** Same pattern. Queries `rewards WHERE proposed_by = auth.uid() AND status IN ('pending_approval', 'archived')`.

Card states identical to chore proposals. Dismiss calls `dismiss_rejected_proposal('reward', id)`.

---

## 6. Admin UI

### 6.1 ChoresPage.tsx — rejection with reason

Currently, "Reject" on a proposal card calls `.update({ status: 'archived' })` directly. Change to:

- For proposal cards (`proposed_by IS NOT NULL`): clicking Reject opens a dialog:
  - Title: "דחיית הצעה"
  - Optional textarea: "סיבת הדחייה (אופציונלי)" with placeholder "ניתן להשאיר ריק..."
  - Buttons: "ביטול" + "דחה הצעה" (destructive, always enabled)
  - On confirm: `.update({ status: 'archived', proposal_rejection_reason: reason.trim() || null })`

- For active chore cards (regular archive action): unchanged — no dialog, direct update.

### 6.2 RewardsPage.tsx — rejection with reason

Identical pattern for reward proposals. Reject on proposals (`proposed_by IS NOT NULL`) opens the same optional-reason dialog.

### 6.3 Editing approved proposals

Admins can edit any active chore or reward — including ones that were player-proposed — using the existing edit form. No notification is sent to the proposing player on edit. The `notify_proposal_resolved` trigger only fires on status change from `pending_approval`; it does not fire on field edits.

---

## 7. Notifications Summary

| Event | Recipient | Type | How |
|---|---|---|---|
| Player submits chore proposal | All admins in family | `proposal_submitted` | DB trigger (in-app) + Edge Function webhook (email) |
| Player submits reward proposal | All admins in family | `proposal_submitted` | DB trigger (in-app) + Edge Function webhook (email) |
| Admin approves chore proposal | Proposing player | `proposal_resolved` | Existing trigger (updated) |
| Admin rejects chore proposal | Proposing player | `proposal_resolved` | Existing trigger (updated, includes reason) |

---

## 8. Error Handling

| Scenario | Behaviour |
|---|---|
| Proposal INSERT fails (RLS, network) | Inline error in dialog, dialog stays open |
| `dismiss_rejected_proposal` RPC fails | Toast error, card stays visible — retry next session |
| Notify-admin-proposal Edge Function fails | Email not sent; in-app notification already inserted atomically by DB trigger — not lost |
| Admin rejection dialog cancelled | No change — proposal stays pending |
| `notify_proposal_resolved` trigger: proposer has no family_id | Skip notification (guard already exists in `insert_notification`) |

---

## 9. Testing

### Migration `031`
- `dismiss_rejected_proposal('chore', id)` with own archived proposal → deleted
- `dismiss_rejected_proposal('chore', id)` with another player's proposal → exception
- `dismiss_rejected_proposal('chore', id)` with own pending proposal → exception
- `dismiss_rejected_proposal('reward', id)` → same three cases
- `dismiss_rejected_proposal('invalid', id)` → exception
- Trigger: INSERT chore with `proposed_by` set → `proposal_submitted` notification created for each admin in family
- Trigger: INSERT chore with `proposed_by = NULL` → no `proposal_submitted` notification
- `notify_proposal_resolved`: rejection with `proposal_rejection_reason` set → reason appears in `body_he`
- `notify_proposal_resolved`: rejection with `proposal_rejection_reason = NULL` → generic body, no crash

### Player UI
- Chore proposal form: empty title → submit disabled; coin_value = 0 → submit disabled; valid form → INSERT called with correct fields; success → dialog closes, proposals section refetches
- Rewards proposal form: same validation
- "ההצעות שלי": pending card shows "ממתין לאישור" badge; rejected card shows "נדחה" badge; click rejected with reason → popup shows reason; click rejected without reason → generic message; "אישור" → `dismiss_rejected_proposal` called → card removed
- Section hidden when no proposals

### Admin UI
- Reject proposal card → reason dialog opens; submit without reason → `proposal_rejection_reason = null`; submit with reason → reason stored; cancel → no update
- Reject regular active chore (proposed_by = NULL) → no dialog, direct archive (unchanged)

### Edge Function `notify-admin-proposal`
- Missing `x-webhook-secret` → 401
- Wrong secret → 401
- Payload with `proposed_by = null` → skipped, 200
- Valid chore proposal payload → email sent to each admin in family
- Valid reward proposal payload → email sent to each admin in family

---

## 10. Out of Scope

- Player can edit or withdraw a pending proposal (future version)
- Admin counter-proposal / negotiation flow
- Push notifications for proposal events
