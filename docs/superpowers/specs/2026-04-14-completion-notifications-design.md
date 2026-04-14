# Completion Notifications — Design Spec

**Date**: 2026-04-14
**Status**: Approved

## Overview

When a player submits a chore completion, all admins in the family receive an email notification. When an admin approves a completion, the player receives an email notification (if they have an email address on their account). Players without an email continue to receive in-app notifications only, as before.

## Scope

- Email notifications only (free tier)
- Future channels: WhatsApp via Meta's Cloud API free tier, SMS excluded (no free option)
- No new DB migrations required — existing schema handles everything

## Architecture

Two Supabase Edge Functions triggered by database webhooks:

```
Player submits completion
        │
        ▼
chore_completions INSERT
        │
        ▼
DB Webhook ──► notify-admin-completion
                    │
                    ├─ Fetch: player name, chore title, coin value
                    ├─ Fetch: all admins in family (role = 'admin')
                    ├─ Fetch: each admin's auth email via service role
                    └─ Send one email per admin via Resend

Admin approves completion
        │
        ▼
chore_completions UPDATE (status → 'approved')
        │
        ▼
DB Webhook ──► notify-player-approval
                    │
                    ├─ Guard: only proceed if new.status = 'approved' AND old.status = 'pending'
                    ├─ Fetch: chore title, coin value
                    ├─ Fetch: player's auth email via service role
                    ├─ Has email? → send via Resend
                    └─ No email? → exit silently (in-app notification already handled)
```

## Edge Functions

### `supabase/functions/notify-admin-completion/index.ts`

**Trigger**: DB webhook on `chore_completions` INSERT

**Steps**:
1. Verify `x-webhook-secret` header matches `WEBHOOK_SECRET` env var → 401 if not
2. Extract `completed_by`, `chore_assignment_id` from webhook payload
3. Query: join `chore_assignments → chores` to get chore title and coin value
4. Query: get player name from `profiles` where `id = completed_by`
5. Query: get family ID from player's profile, then all `profiles` where `family_id = X` and `role = 'admin'`
6. For each admin: fetch auth email via `supabase.auth.admin.getUserById(admin_id)`
7. Send one email per admin via Resend API

### `supabase/functions/notify-player-approval/index.ts`

**Trigger**: DB webhook on `chore_completions` UPDATE

**Steps**:
1. Verify `x-webhook-secret` header → 401 if not
2. Check `new.status === 'approved'` and `old.status === 'pending'` → exit silently if not
3. Query: join `chore_assignments → chores` to get chore title and coin value
4. Fetch player's auth email via `supabase.auth.admin.getUserById(completed_by)`
5. If email exists → send via Resend; if not → exit (in-app notification already handles this)

## Email Content

### Admin email (player submitted)

- **Subject**: ✅ `[שם השחקן]` השלים/ה את המשימה ״`[שם המשימה]`״
- **Body**:
  - `[שם השחקן]` השלים/ה את המשימה ״`[שם המשימה]`״ ומחכה לאישורך
  - ערך המשימה: `[X]` מטבעות
  - CTA button: לאישור ההגשה ← (links to app root)

### Player email (admin approved)

- **Subject**: 🎉 הגשתך אושרה! קיבלת `[X]` מטבעות
- **Body**:
  - שלום `[שם השחקן]`
  - המשימה ״`[שם המשימה]`״ אושרה על ידי המנהל
  - זוכו לחשבונך `[X]` מטבעות
  - CTA button: לצפייה ביתרתך ← (links to app root)

Both emails are Hebrew RTL HTML. No photo attachments — admin clicks through to the app to view photos.

## Multiple Admins — Double-Approval Prevention

All admins receive the notification email independently. The existing `approve_completion` RPC already prevents double-approval:

```sql
IF v_completion.status <> 'pending' THEN
  RAISE EXCEPTION 'Completion is not pending';
END IF;
```

The first admin to approve wins atomically. A second admin clicking approve will hit this check.

**UI fix required**: `CompletionsPage.tsx` currently shows a generic error ("שגיאה באישור ההגשה") when this exception is thrown. The fix: detect the "not pending" error and show:
> הגשה זו כבר אושרה על ידי מנהל אחר

Then call `refetch()` so the completion disappears from the list.

## Environment Variables

| Variable | Source | How to set |
|----------|--------|------------|
| `SUPABASE_URL` | Auto-injected by Supabase runtime | Nothing to do |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by Supabase runtime | Nothing to do |
| `WEBHOOK_SECRET` | Self-generated (`openssl rand -hex 32`) | Supabase Dashboard → Edge Functions → Manage secrets |
| `RESEND_API_KEY` | Resend account (resend.com, free tier) | Supabase Dashboard → Edge Functions → Manage secrets |
| `FROM_EMAIL` | Verified sender in Resend | Supabase Dashboard → Edge Functions → Manage secrets |

For testing without a verified domain, Resend's sandbox address `onboarding@resend.dev` works.

## Webhook Configuration

Create two webhooks in Supabase Dashboard → Database → Webhooks.

**Do not create webhooks until Edge Functions are deployed** — the URLs won't resolve until the functions are live.

### Webhook 1: notify-admin-completion

| Field | Value |
|-------|-------|
| Name | `notify-admin-completion` |
| Table | `chore_completions` |
| Events | INSERT |
| Method | POST |
| URL | `https://<project-ref>.supabase.co/functions/v1/notify-admin-completion` |
| Headers | `Content-Type: application/json`, `x-webhook-secret: <WEBHOOK_SECRET>` |

### Webhook 2: notify-player-approval

| Field | Value |
|-------|-------|
| Name | `notify-player-approval` |
| Table | `chore_completions` |
| Events | UPDATE |
| Method | POST |
| URL | `https://<project-ref>.supabase.co/functions/v1/notify-player-approval` |
| Headers | `Content-Type: application/json`, `x-webhook-secret: <WEBHOOK_SECRET>` |

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/notify-admin-completion/index.ts` | New Edge Function |
| `supabase/functions/notify-player-approval/index.ts` | New Edge Function |
| `src/pages/admin/completions/CompletionsPage.tsx` | Improve double-approval error message |

## Out of Scope

- Admin opt-in/opt-out toggle for email notifications
- Notification history / email log
- WhatsApp and SMS (future, after email is stable)
- Player notification email for rejection (in-app notification already handles this)
