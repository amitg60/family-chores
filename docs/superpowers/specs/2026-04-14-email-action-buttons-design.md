# Email Action Buttons & Proof Photo Design Spec

**Date**: 2026-04-14 (revised 2026-04-17)
**Status**: Approved

## Overview

Enhance the admin notification email to show the player's proof photo inline and include Approve / Reject buttons. Clicking a button opens a hosted confirmation page (no web-app login required). Confirming on that page executes the action directly. The admin never needs to open the family-chores web app.

## Scope

- Inline proof photo in admin notification email
- Approve and Reject buttons linking to a hosted confirmation page
- HMAC-signed tokens (7-day expiry, per-admin, action-specific)
- Two-step flow: GET → confirmation page; POST → state change
- Hebrew result pages after confirmation
- Durable audit log table (`email_action_log`) — **one new DB migration**
- No new secrets required

## Architecture

```
notify-admin-completion sends email to each admin
  → each admin's email contains their unique approve/reject tokens
  → admin sees inline proof photo
  → admin clicks Approve or Reject

        GET ?token=<signed-token>
              │
              ├─ Token invalid/expired ──────────────────→ Terminal: "הקישור אינו תקף"
              ├─ Completion already actioned ────────────→ Terminal: "הגשה זו כבר טופלה"
              └─ Token valid, completion pending ────────→ Confirmation page (form, POST)

        POST ?token=<signed-token>
              │
              ├─ Token invalid/expired ──────────────────→ Terminal: "הקישור אינו תקף"
              ├─ Completion already actioned (RPC check) → Terminal: "הגשה זו כבר טופלה"
              ├─ Service client failure ─────────────────→ Terminal: "שגיאה זמנית"
              ├─ Approve → approve_completion() ─────────→ Insert audit row → Terminal: "✅ אושר"
              └─ Reject  → reject_completion()  ─────────→ Insert audit row → Terminal: "❌ נדחה"
```

**GET never changes state. POST is the only step that calls an RPC or writes the audit log.**

---

## Security Model

The email link is the sole authentication factor for this flow. No password, session cookie, or app login is required. This is intentional — the HMAC-signed token carries all necessary authorization.

### Protections

| Threat | Mitigation |
|--------|-----------|
| **Link pre-fetching** (Gmail Safe Browsing, Outlook ATP automatically GET links) | Two-step flow: GET only renders a confirmation page; POST executes the RPC. Pre-fetchers send GET only and never trigger state change. |
| **Token forgery** | HMAC-SHA256 with `WEBHOOK_SECRET`; forging a valid signature requires the secret. |
| **Cross-action substitution** (using an approve token to reject) | `action` is inside the signed payload; any modification invalidates the HMAC. |
| **Cross-admin substitution** (using another admin's token) | `adminId` is inside the signed payload; modification invalidates the HMAC. |
| **Token replay before expiry (double-click)** | RPC checks `status = 'pending'` atomically. Second POST returns "already actioned" without a second audit row. |
| **Token replay after expiry** | Expiry validated on every GET and POST before any DB access. |
| **Token leakage via email forwarding** | Tokens have a 7-day TTL. The RPCs' `status = 'pending'` check means a leaked token can only trigger an action that was going to happen anyway (the completion was still pending). |
| **Token leakage via server logs** | Token appears in the URL query string. Supabase Edge Function logs are accessible only to project owners with service-role credentials. No mitigation beyond TTL and single-use business logic is required. |
| **Brute-force token guessing** | 256-bit HMAC signature makes guessing computationally infeasible. |

### What the token does NOT protect

- **Admin identity is asserted, not authenticated.** The `adminId` in the token identifies which admin this token was minted for, but does not verify the person clicking is that admin. If an admin forwards the email, the recipient can act on their behalf. This is documented and accepted as out of scope for the free-tier email channel.
- **Replay between success and expiry.** After a successful action, the token remains cryptographically valid until its expiry. Any subsequent POST returns "already actioned" — no additional state change is possible.

---

## Token Format

**Encoding**: base64url per RFC 4648 §5 — URL-safe alphabet (`-` and `_` replace `+` and `/`), no padding. All string fields encoded as UTF-8.

```
<payloadB64url>.<sigB64url>
```

where:

```
payload      = completionId + ":" + action + ":" + adminId + ":" + expiry
payloadB64url = base64url( UTF-8(payload) )
sig          = HMAC-SHA256( UTF-8(payload), UTF-8(WEBHOOK_SECRET) )
sigB64url    = base64url( sig )
```

| Field | Type | Example |
|-------|------|---------|
| `completionId` | UUID string | `a1b2c3d4-...` |
| `action` | `"approve"` or `"reject"` | `"approve"` |
| `adminId` | UUID string (profile ID) | `e5f6a7b8-...` |
| `expiry` | Unix timestamp, decimal integer | `1745856000` |

Including `adminId` in the signed payload means:
- Each admin receives their own unique token — one admin cannot use another's token.
- The audit log row records which admin was the intended actor.

**base64url helpers** (shared between both functions):

```typescript
function toB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(s.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}
```

---

## Two-Step Flow

### Step 1 — GET (confirmation page, no state change)

The email buttons are `<a href="...?token=...">` links. On click, the browser sends a GET.

The handler:
1. Parses and validates the token (signature + expiry).
2. Reads `completion.status` from the DB.
3. If already actioned (status ≠ `'pending'`): returns terminal "already actioned" page.
4. If pending: returns a confirmation HTML page containing:
   - The action description in Hebrew ("אתה עומד לאשר" / "אתה עומד לדחות")
   - A `<form method="POST" action="?token=<token>">` where the form action URL carries the token as a query parameter
   - A single large submit button ("אשר" / "דחה")
   - No hidden inputs for the token — it travels in the form action URL

The token passes from GET to POST via the form's `action` attribute query string. Since the token was already in the email (an authenticated channel), embedding it in the form URL is not a new exposure.

**GET never calls `approve_completion`, `reject_completion`, or `email_action_log`.**

### Step 2 — POST (execution, state change)

The confirmation form submits a POST to the same URL with the token in the query string.

The handler:
1. Parses and validates the token (signature + expiry).
2. Calls the RPC.
3. Inserts an audit row (see Audit Log section).
4. Returns the result page.

Token loss is impossible: the token is in the URL at all times, not in session state or form fields that could be cleared.

---

## Durable Audit Log

Every successful POST (action executed) inserts one row into `email_action_log`. This provides a permanent record independent of function logs.

### Schema (new migration)

```sql
CREATE TABLE email_action_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id uuid        NOT NULL REFERENCES chore_completions(id),
  admin_id      uuid        NOT NULL REFERENCES profiles(id),
  action        text        NOT NULL CHECK (action IN ('approve', 'reject')),
  source        text        NOT NULL DEFAULT 'email',
  actioned_at   timestamptz NOT NULL DEFAULT now()
);

-- Admins can read their own rows; service role handles inserts
ALTER TABLE email_action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read own rows"
  ON email_action_log FOR SELECT
  USING (admin_id = auth.uid());
```

### When the row is inserted

The audit row is inserted **after** the RPC succeeds and **before** the result page is returned. If the RPC fails (any reason), no audit row is written.

### Recovering operator identity

`admin_id` is populated from the `adminId` field in the HMAC-signed token. Since the token was minted per-admin in `notify-admin-completion`, `admin_id` identifies which admin's email was used to trigger the action — not which human was physically at the keyboard, but which account received the link.

If `admin_id` is needed in the context where `auth.uid()` is expected (e.g., `reviewed_by` in `chore_completions`), the existing RPC will record `NULL` there because the service-role client has no auth context. The `email_action_log` table is the authoritative identity source for email-channel actions.

### Console log (belt-and-suspenders)

In addition to the DB row, the POST handler logs before calling the RPC:

```
[EMAIL-ACTION] completionId=<uuid> action=approve|reject adminId=<uuid>
```

This allows operators to correlate Edge Function logs with `email_action_log` rows if needed.

---

## Error Classification

Errors fall into two categories with different handling.

### Business-rule errors (expected)

| Error | User page | Log |
|-------|-----------|-----|
| Token missing from query string | 400 + "הקישור שגוי" text | None |
| Token malformed, HMAC invalid, or expired | "הקישור אינו תקף" page | None |
| Completion not found or already actioned | "הגשה זו כבר טופלה" page | None |

No stack traces or internal details reach the user for these cases.

### Infrastructure errors (unexpected)

| Error | User page | Log |
|-------|-----------|-----|
| `WEBHOOK_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` missing | "שגיאה זמנית" page | `[INFRA] missing env: <name>` |
| Supabase client creation throws | "שגיאה זמנית" page | `[INFRA] client creation failed: <error>` |
| DB status check (GET) fails | "שגיאה זמנית" page | `[INFRA] status check failed: <error>` |
| RPC returns unexpected error | "שגיאה זמנית" page | `[INFRA] rpc failed completionId=<uuid> action=<action>: <error>` |
| Audit log insert fails | "✅/❌" success page (action succeeded) | `[INFRA] audit insert failed completionId=<uuid>: <error>` |

The user-facing "שגיאה זמנית" page includes: "אירעה שגיאה. אנא נסה שוב מאוחר יותר או פתח את האפליקציה."

Audit log insert failure is non-fatal — the action already succeeded and cannot be undone. Log the failure and return success.

**Service client creation is a distinct error case.** Creating the Supabase client is wrapped in a try/catch. Failure returns "שגיאה זמנית" immediately without attempting any RPC or DB call.

---

## Error / Result Matrix

All HTML responses use `Content-Type: text/html; charset=utf-8`, `dir="rtl"`, status 200 (except 400 for missing token).

### GET requests

| Condition | Response |
|-----------|----------|
| `token` param missing | 400, plain text "missing token" |
| Token malformed / HMAC invalid / expired | Terminal: "הקישור אינו תקף או פג תוקפו. אנא פתח את האפליקציה לאישור ידני." |
| DB status check fails (infra error) | Terminal: "שגיאה זמנית. אנא נסה שוב מאוחר יותר." |
| Completion already actioned | Terminal: "ℹ️ הגשה זו כבר טופלה." |
| Token valid, completion pending, action=approve | Confirmation page: "אתה עומד לאשר את ההגשה. לחץ לאישור." + [אשר] button |
| Token valid, completion pending, action=reject | Confirmation page: "אתה עומד לדחות את ההגשה. לחץ לדחייה." + [דחה] button |

### POST requests

| Condition | Response |
|-----------|----------|
| `token` param missing | 400, plain text "missing token" |
| Token malformed / HMAC invalid / expired | Terminal: "הקישור אינו תקף או פג תוקפו. אנא פתח את האפליקציה לאישור ידני." |
| Service client creation fails (infra error) | Terminal: "שגיאה זמנית. אנא נסה שוב מאוחר יותר." |
| RPC throws "not pending" | Terminal: "ℹ️ הגשה זו כבר טופלה." |
| RPC throws unknown error | Terminal: "שגיאה זמנית. אנא נסה שוב מאוחר יותר." |
| action=approve, RPC succeeds | Terminal: "✅ ההגשה אושרה בהצלחה. השחקן יקבל את המטבעות." |
| action=reject, RPC succeeds | Terminal: "❌ ההגשה נדחתה." |

---

## Message Consistency

The same action labels and phrasing appear in the email, confirmation page, and result page.

| Stage | Approve label | Reject label |
|-------|--------------|-------------|
| Email button | ✅ אשר | ❌ דחה |
| Confirmation page heading | אתה עומד לאשר את ההגשה | אתה עומד לדחות את ההגשה |
| Confirmation page button | אשר | דחה |
| Result page | ✅ ההגשה אושרה בהצלחה. השחקן יקבל את המטבעות. | ❌ ההגשה נדחתה. |
| Already actioned (any step) | ℹ️ הגשה זו כבר טופלה. | ℹ️ הגשה זו כבר טופלה. |
| Token invalid (any step) | ⚠️ הקישור אינו תקף או פג תוקפו. אנא פתח את האפליקציה לאישור ידני. | same |
| Infrastructure error (any step) | ⚠️ שגיאה זמנית. אנא נסה שוב מאוחר יותר. | same |

---

## Image Handling

### Photo constraints

Photos are compressed by the player's app before upload (`compressPhoto` in `photoUtils.ts`):
- Format: WebP
- Max file size: ~200 KB
- Max dimensions: 1280 × 1280 px

These constraints apply to what is stored. The email displays the photo within the above limits.

### Email display

```html
<img src="<signedUrl>"
     alt="תמונת הוכחה שצולמה על ידי השחקן"
     width="400"
     style="max-width:100%;border-radius:8px;display:block;margin:16px 0;">
<p style="font-size:12px;color:#6b7280;">תמונת הוכחה לביצוע המשימה</p>
```

- `alt` text is always present so the email makes sense if the image does not render
- The caption below the image ("תמונת הוכחה לביצוע המשימה") is plain text — visible even when images are blocked
- The signed URL is valid for 7 days, matching the token expiry; after 7 days the image will not load in older emails, but the token will also be expired and no action is possible
- If `photo_url` is null (player submitted without photo), the `<img>` and caption are omitted entirely; the email still makes sense without them

---

## Changes to `notify-admin-completion`

### Payload changes

Extract additional fields from `payload.record`:

```typescript
const record = payload.record as {
  id: string                    // completion ID for token generation
  completed_by: string
  chore_assignment_id: string
  photo_url: string | null
}
```

Validate that `id` is a non-empty string; `photo_url` may be null.

### Per-admin token generation

Generate two tokens per admin (approve + reject), including the admin's profile ID:

```typescript
async function generateToken(
  completionId: string,
  action: 'approve' | 'reject',
  adminId: string,
  secret: string
): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  const payload = `${completionId}:${action}:${adminId}:${expiry}`
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return toB64url(enc.encode(payload)) + '.' + toB64url(new Uint8Array(sig))
}
```

For each admin, generate `approveToken` and `rejectToken` individually.

### Photo signed URL

```typescript
const { data: signedData } = await supabase.storage
  .from('completion-photos')
  .createSignedUrl(record.photo_url, 7 * 24 * 60 * 60)
```

Use `signedData?.signedUrl` in the template. If null, omit the image block.

### Updated email template

```
[שם השחקן] השלים/ה את המשימה ״[שם המשימה]״ ומחכה לאישורך.
ערך המשימה: [X] מטבעות

[תמונת הוכחה — <img alt="תמונת הוכחה שצולמה על ידי השחקן">, max-width 400px]
[כיתוב: "תמונת הוכחה לביצוע המשימה" — always shown as plain text]

[✅ אשר]   [❌ דחה]
```

Both buttons are `<a>` links:
```
https://<ref>.supabase.co/functions/v1/handle-completion-action?token=<per-admin-token>
```

The CTA link to the app URL is removed. The email is self-contained; all actions complete on the hosted confirmation page.

---

## New Edge Function: `handle-completion-action`

**File**: `supabase/functions/handle-completion-action/index.ts`

**Deploy**: `--no-verify-jwt` (no Supabase JWT required — token is the auth)

### GET handler

```
1. Read `token` from query string → 400 "missing token" if absent
2. Validate token (signature + expiry) → terminal "invalid/expired" page if invalid
3. Extract { completionId, action, adminId } from payload
4. Create Supabase service-role client
   → on failure: log [INFRA], return "שגיאה זמנית" page
5. Read completion.status from DB
   → on DB error: log [INFRA], return "שגיאה זמנית" page
   → if status ≠ 'pending': return "already actioned" page
6. Return confirmation HTML page with:
   - Hebrew description of the pending action
   - <form method="POST" action="?token=<token>"> 
   - One submit button (label from Message Consistency table)
```

### POST handler

```
1. Read `token` from query string → 400 "missing token" if absent
2. Validate token (signature + expiry) → terminal "invalid/expired" page if invalid
3. Extract { completionId, action, adminId } from payload
4. Log: [EMAIL-ACTION] completionId=<uuid> action=<action> adminId=<uuid>
5. Create Supabase service-role client
   → on failure: log [INFRA], return "שגיאה זמנית" page
6. Call RPC:
   - approve: supabase.rpc('approve_completion', { completion_id: completionId })
   - reject:  supabase.rpc('reject_completion', { completion_id: completionId, reason: 'נדחה על ידי המנהל' })
   → on "not pending" error: return "already actioned" page (no audit insert)
   → on other RPC error: log [INFRA], return "שגיאה זמנית" page (no audit insert)
7. Insert into email_action_log: { completion_id, admin_id, action, source: 'email' }
   → on insert error: log [INFRA] audit insert failed — return success page anyway
8. Return result page (see Message Consistency table)
```

### Token validation

```typescript
async function validateToken(
  token: string,
  secret: string
): Promise<{ completionId: string; action: string; adminId: string } | null> {
  try {
    const [payloadB64url, sigB64url] = token.split('.')
    if (!payloadB64url || !sigB64url) return null
    const enc = new TextEncoder()
    const payloadBytes = fromB64url(payloadB64url)
    const payload = new TextDecoder().decode(payloadBytes)
    const [completionId, action, adminId, expiryStr] = payload.split(':')
    if (!completionId || !action || !adminId || !expiryStr) return null
    if (Math.floor(Date.now() / 1000) > parseInt(expiryStr, 10)) return null
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sigBytes = fromB64url(sigB64url)
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload))
    if (!valid) return null
    return { completionId, action, adminId }
  } catch {
    return null
  }
}
```

---

## State Transition Guarantee

The Edge Function **never directly updates `chore_completions`**. All state transitions go exclusively through:

- `approve_completion(completion_id)` → sole path to `status = 'approved'`
- `reject_completion(completion_id, reason)` → sole path to `status = 'rejected'`

This ensures coin crediting, in-app notifications, and `reviewed_by` audit fields run consistently regardless of whether the action originated from the web app or an email button.

`reviewed_by` will be `NULL` for email-based actions (service-role client has no `auth.uid()`). The `email_action_log.admin_id` field is the identity record for email-channel actions.

---

## Token Reuse Policy

Tokens are not invalidated on use. After a successful action:

- **POST** returns "already actioned" without inserting a second audit row (RPC's `status = 'pending'` check prevents it).
- **GET** returns "already actioned" because the DB status check shows a non-pending completion.
- Tokens remain valid as HMAC signatures until their 7-day expiry, but they can only produce terminal pages once the completion is no longer pending.

This behavior is intentional — it handles double-click, email client retry, and email forwarding gracefully without a token store.

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/<timestamp>_email_action_log.sql` | New table + RLS policy |
| `supabase/functions/notify-admin-completion/index.ts` | Extract `id` + `photo_url`; generate per-admin HMAC tokens including `adminId`; add photo block with alt/caption; update email template |
| `supabase/functions/handle-completion-action/index.ts` | New function — two-step GET/POST, token validation, status pre-check on GET, audit log insert on POST, classified error handling |

## Out of Scope

- Custom reject reason from email (fixed reason used)
- Admin opt-out from email action buttons
- Verified admin identity (token identifies the intended admin; physical actor is not verified)
- Player notification email for rejection (in-app notification already handles it)
- Token revocation before expiry (RPC status check and 7-day TTL are sufficient)
