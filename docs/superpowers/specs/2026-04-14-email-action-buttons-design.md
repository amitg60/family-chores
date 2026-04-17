# Email Action Buttons & Proof Photo Design Spec

**Date**: 2026-04-14 (revised 2026-04-17)
**Status**: Approved

## Overview

Enhance the admin notification email to show the player's proof photo inline and include Approve / Reject buttons. Clicking a button opens a hosted confirmation page (no web-app login required). Confirming on that page executes the action directly. The admin never needs to open the family-chores web app to approve or reject a completion.

## Scope

- Inline proof photo in admin notification email
- Approve and Reject buttons linking to a hosted confirmation page
- HMAC-signed tokens (7-day expiry, per-admin, action-specific)
- Two-step flow: GET → confirmation page only; POST → state change only
- Hebrew result pages after confirmation
- Durable audit log table (`email_action_log`) — **one new DB migration**
- No new secrets required

## Architecture

```
notify-admin-completion sends email to each admin
  → each admin's email contains their own unique approve/reject tokens
  → admin sees inline proof photo
  → admin clicks Approve or Reject

        GET ?token=<signed-token>                    ← read-only, no state change
              │
              ├─ Token invalid / expired / infra ────→ Terminal: generic failure page
              ├─ Completion already actioned ────────→ Terminal: "הגשה זו כבר טופלה"
              └─ Token valid, completion pending ────→ Confirmation page (form, POST)

        POST ?token=<signed-token>                   ← only step that mutates state
              │
              ├─ Token invalid / expired / infra ────→ Terminal: generic failure page
              ├─ RPC throws "not pending" ───────────→ Terminal: "הגשה זו כבר טופלה"
              ├─ RPC throws unknown error ───────────→ Terminal: generic failure page
              ├─ Approve → approve_completion() ─────→ Insert audit row → "✅ אושר"
              └─ Reject  → reject_completion()  ─────→ Insert audit row → "❌ נדחה"
```

**GET never calls an RPC, never writes to `email_action_log`, and never changes any DB state.**
**POST is the only step that calls an RPC or writes the audit log.**

---

## Security Model

### Authentication factor

The email link is the sole authentication factor. There is no password, session cookie, JWT, or app login involved. The HMAC-signed token in the URL is the complete authorization credential.

**Consequence**: whoever holds the link can act. If an admin forwards the email, the recipient inherits the ability to approve or reject. This is an accepted, intentional tradeoff for the free-tier email channel; mitigating it (e.g., requiring app login after clicking) is out of scope.

### Identity claim

The `adminId` field embedded in the token identifies the **intended recipient** — the admin whose email address received the notification. It is used exclusively for audit attribution. It does not verify, and must not be presented as evidence of, who physically clicked the link. The system has no mechanism to distinguish the intended recipient from anyone else who obtained the URL.

### Protections

| Threat | Mitigation |
|--------|-----------|
| **Link pre-fetching** (Gmail Safe Browsing, Outlook ATP GET links before user sees them) | Two-step flow: GET only renders a confirmation page and never calls an RPC. Pre-fetchers send GET and cannot trigger a state change. |
| **Token forgery** | HMAC-SHA256 with `WEBHOOK_SECRET`; a valid signature requires the secret. |
| **Cross-action substitution** (using an approve token to reject) | `action` is inside the signed payload; any modification invalidates the HMAC. |
| **Cross-admin substitution** (using another admin's token) | `adminId` is inside the signed payload; modification invalidates the HMAC. |
| **Token replay (double-click or retry)** | POST calls the RPC directly; the RPC's atomic `status = 'pending'` check prevents a second state change. A second POST returns "already actioned" with no audit insert. |
| **Token replay after expiry** | Expiry is validated on every GET and POST before any DB access. |
| **Token leakage via email forwarding** | Tokens expire after 7 days. A leaked token can only trigger an action that was going to happen anyway (completion still pending). Once actioned, any further use of the token returns "already actioned." |
| **Token leakage via server logs** | Token appears in the query string. Supabase Edge Function logs are accessible only to project owners with service-role credentials. The 7-day TTL and RPC status check limit the exposure window and blast radius. |
| **Brute-force guessing** | 256-bit HMAC signature makes guessing computationally infeasible. |

### Accepted risks

- Email forwarding transfers the ability to act. This is intentional and out of scope for this flow.
- `adminId` in the token asserts intended recipient, not verified identity. Audit records record who was meant to act, not who did.
- `reviewed_by` in `chore_completions` will be `NULL` for email-based actions (service-role client has no `auth.uid()`). The `email_action_log` table is the authoritative record for email-channel actions.

---

## Token Format

**Encoding**: base64url per RFC 4648 §5 — URL-safe alphabet (`-` and `_` replace `+` and `/`), no padding. All string fields encoded as UTF-8.

```
<payloadB64url>.<sigB64url>
```

where:

```
payload       = completionId + ":" + action + ":" + adminId + ":" + expiry
payloadB64url = base64url( UTF-8(payload) )
sig           = HMAC-SHA256( UTF-8(payload), UTF-8(WEBHOOK_SECRET) )
sigB64url     = base64url( sig )
```

| Field | Type | Example |
|-------|------|---------|
| `completionId` | UUID string | `a1b2c3d4-...` |
| `action` | `"approve"` or `"reject"` | `"approve"` |
| `adminId` | UUID string (profile ID of intended recipient) | `e5f6a7b8-...` |
| `expiry` | Unix timestamp, decimal integer | `1745856000` |

Each admin receives their own unique tokens for a given completion. `adminId` in the token ensures that a token minted for admin A cannot be used with admin B's identity claim.

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

### Step 1 — GET (read-only)

The email buttons are `<a href="...?token=...">` links. Clicking opens a browser GET.

```
1. Parse and validate token (signature + expiry)
   → failure: return generic terminal page (no indication of failure type)
2. Create Supabase service-role client
   → failure: log [INFRA], return generic terminal page
3. Read completion.status from DB
   → DB error: log [INFRA], return generic terminal page
   → status ≠ 'pending': return "already actioned" terminal page
4. Return confirmation HTML page:
   - Hebrew description of the action ("אתה עומד לאשר את ההגשה" / "אתה עומד לדחות את ההגשה")
   - <form method="POST" action="?token=<token>">
   - One submit button labelled "אשר" or "דחה"
```

**GET stops here. No RPC call. No audit write. No state change of any kind.**

The token travels from GET to POST via the form's `action` attribute query string. The token was already in the email (an authenticated channel), so embedding it in the form URL is not a new exposure. There are no hidden inputs — the token cannot be silently dropped.

### Step 2 — POST (execution)

The confirmation form submits a POST to the same URL with the token in the query string.

```
1. Parse and validate token (signature + expiry)
   → failure: return generic terminal page
2. Log: [EMAIL-ACTION] completionId=<uuid> action=<action> adminId=<uuid>
3. Create Supabase service-role client
   → failure: log [INFRA], return generic terminal page
4. Call RPC directly — no pre-check of completion status:
   - approve: supabase.rpc('approve_completion', { completion_id: completionId })
   - reject:  supabase.rpc('reject_completion', { completion_id: completionId, reason: 'נדחה על ידי המנהל' })
   → RPC throws "not pending": return "already actioned" terminal page (no audit insert)
   → RPC throws anything else: log [INFRA], return generic terminal page (no audit insert)
5. Insert into email_action_log: { completion_id, admin_id, action, source: 'email' }
   → insert error: log [INFRA] audit insert failed — return success page anyway (action already committed)
6. Return success result page ("✅ ההגשה אושרה" or "❌ ההגשה נדחתה")
```

**POST does not pre-check completion status before calling the RPC.** It calls the RPC directly and relies on the RPC's atomic `status = 'pending'` guard. If the completion is already actioned, the RPC raises "not pending" and POST maps that exception to the "already actioned" page. This is correct: the RPC check is atomic and eliminates the TOCTOU race that a pre-check would introduce.

---

## Durable Audit Log

`email_action_log` is the source of truth for email-based actions. Function logs are secondary and supplementary. An operator investigating an email-triggered approve or reject must consult this table first.

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

ALTER TABLE email_action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read own rows"
  ON email_action_log FOR SELECT
  USING (admin_id = auth.uid());
```

`admin_id` is populated from the `adminId` field in the HMAC-signed token. It records the **intended recipient** of the email — not a verified claim about who physically clicked. This distinction must be preserved in any reporting or audit UI built on this table.

### Write timing

The audit row is inserted after the RPC succeeds and before the result page is returned. If the RPC fails for any reason, no audit row is written.

Audit log insert failure is non-fatal. The state change has already been committed by the RPC and cannot be undone. In this case: log the insert failure with `[INFRA]`, then return the success page. The `[EMAIL-ACTION]` log line written before the RPC call provides a fallback record.

---

## Error Classification

### Business-rule errors (expected, no operator action needed)

| Error | User sees | Operator log |
|-------|-----------|-----|
| Token missing from query string | 400, plain text | None |
| Token malformed / HMAC invalid / expired | Generic terminal page | None |
| Completion not found or already actioned | "already actioned" terminal page | None |

### Infrastructure errors (unexpected, operator should investigate)

| Error | User sees | Operator log |
|-------|-----------|-----|
| Env var missing (`WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) | Generic terminal page | `[INFRA] missing env: <name>` |
| Supabase client creation throws | Generic terminal page | `[INFRA] client creation failed: <error>` |
| DB status check fails (GET) | Generic terminal page | `[INFRA] status check failed: <error>` |
| RPC returns unexpected error | Generic terminal page | `[INFRA] rpc failed completionId=<uuid> action=<action>: <error>` |
| Audit log insert fails | Success page (action committed) | `[INFRA] audit insert failed completionId=<uuid>: <error>` |

**Service client creation is a distinct error case.** It is wrapped in a try/catch separate from the RPC call. Failure returns the generic terminal page immediately without attempting any DB access.

### Terminal page policy

All non-success terminal pages (token invalid, infra error) show the same generic message to the user:

> ⚠️ לא ניתן לבצע את הפעולה. אנא פתח את האפליקציה.

Users cannot determine from the page whether the failure was caused by an invalid token, an expired token, or an infrastructure problem. The cause is recorded in operator logs only.

The "already actioned" page is the one exception — it is a distinct business outcome and intentionally visible:

> ℹ️ הגשה זו כבר טופלה.

---

## Error / Result Matrix

All HTML responses use `Content-Type: text/html; charset=utf-8`, `dir="rtl"`, status 200 (except 400 for missing token).

### GET

| Condition | User response |
|-----------|--------------|
| `token` param missing | 400, plain text |
| Token invalid / expired / infra failure | Generic terminal: "⚠️ לא ניתן לבצע את הפעולה. אנא פתח את האפליקציה." |
| Completion already actioned | "ℹ️ הגשה זו כבר טופלה." |
| Token valid, completion pending, action=approve | Confirmation: "אתה עומד לאשר את ההגשה. לחץ לאישור." + [אשר] |
| Token valid, completion pending, action=reject | Confirmation: "אתה עומד לדחות את ההגשה. לחץ לדחייה." + [דחה] |

### POST

| Condition | User response |
|-----------|--------------|
| `token` param missing | 400, plain text |
| Token invalid / expired / infra failure | Generic terminal: "⚠️ לא ניתן לבצע את הפעולה. אנא פתח את האפליקציה." |
| RPC throws "not pending" | "ℹ️ הגשה זו כבר טופלה." |
| RPC throws unknown error | Generic terminal: "⚠️ לא ניתן לבצע את הפעולה. אנא פתח את האפליקציה." |
| action=approve, RPC succeeds | "✅ ההגשה אושרה בהצלחה. השחקן יקבל את המטבעות." |
| action=reject, RPC succeeds | "❌ ההגשה נדחתה." |

**"Already actioned" contract**: both GET (via DB status check) and POST (via RPC exception mapping) return the identical "הגשה זו כבר טופלה" terminal page, with no indication of which step detected the condition.

---

## Message Consistency

The same action labels and phrasing appear in the email, confirmation page, and result page.

| Stage | Approve | Reject |
|-------|---------|--------|
| Email button | ✅ אשר | ❌ דחה |
| Confirmation heading | אתה עומד לאשר את ההגשה | אתה עומד לדחות את ההגשה |
| Confirmation button | אשר | דחה |
| Result page | ✅ ההגשה אושרה בהצלחה. השחקן יקבל את המטבעות. | ❌ ההגשה נדחתה. |
| Already actioned (GET or POST) | ℹ️ הגשה זו כבר טופלה. | ℹ️ הגשה זו כבר טופלה. |
| Any failure (GET or POST) | ⚠️ לא ניתן לבצע את הפעולה. אנא פתח את האפליקציה. | same |

---

## Token Replay Policy

Tokens are not invalidated on use. A token remains cryptographically valid (correct HMAC, unexpired) until its 7-day TTL elapses, but **it must not and cannot cause a second state change once the completion is no longer pending**:

- A second POST with a valid token hits the RPC, which atomically checks `status = 'pending'` and raises "not pending". The handler maps this to the "already actioned" page. No audit row is inserted.
- A GET after the action has been taken reads `status ≠ 'pending'` and returns the "already actioned" page without rendering the confirmation form.

Allowing replay-to-terminal-page is intentional. It handles double-click, email client retries, and email forwarding gracefully without requiring a token store or revocation mechanism.

---

## Image Handling

### Photo constraints

Photos are compressed by the player's app before upload (`compressPhoto` in `photoUtils.ts`):
- Format: WebP
- Max file size: ~200 KB
- Max dimensions: 1280 × 1280 px

### Signed URL expiry

The photo signed URL and the action tokens share the same 7-day TTL. Both are generated at the same moment in `notify-admin-completion`. When the token expires and no action is possible, the photo URL also expires. An admin opening an old email after 7 days will find both the image and the action buttons non-functional.

### Email display

```html
<img src="<signedUrl>"
     alt="תמונת הוכחה שצולמה על ידי השחקן"
     width="400"
     style="max-width:100%;border-radius:8px;display:block;margin:16px 0;">
<p style="font-size:12px;color:#6b7280;">תמונת הוכחה לביצוע המשימה</p>
```

- The `alt` attribute is always present; the email makes sense if the image does not render.
- The plain-text caption ("תמונת הוכחה לביצוע המשימה") appears below the image and is visible even when images are blocked by the email client.
- If `photo_url` is null (no photo submitted), the `<img>` block and caption are omitted entirely; the rest of the email remains coherent without them.

---

## Changes to `notify-admin-completion`

### Payload changes

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

Two tokens are generated per admin (approve + reject), each embedding the admin's profile ID:

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

### Photo signed URL

```typescript
const { data: signedData } = await supabase.storage
  .from('completion-photos')
  .createSignedUrl(record.photo_url, 7 * 24 * 60 * 60) // same TTL as tokens
```

Use `signedData?.signedUrl`. If null, omit the image block.

### Updated email template

```
[שם השחקן] השלים/ה את המשימה ״[שם המשימה]״ ומחכה לאישורך.
ערך המשימה: [X] מטבעות

[<img alt="תמונת הוכחה שצולמה על ידי השחקן" width="400" max-width:100%>]
[כיתוב: "תמונת הוכחה לביצוע המשימה" — plain text, always shown]

[✅ אשר]   [❌ דחה]
```

Both buttons are `<a>` links:
```
https://<ref>.supabase.co/functions/v1/handle-completion-action?token=<per-admin-token>
```

The old CTA link to the app URL is removed. All actions complete on the hosted confirmation page without requiring a web-app login.

---

## New Edge Function: `handle-completion-action`

**File**: `supabase/functions/handle-completion-action/index.ts`

**Deploy**: `--no-verify-jwt` (the HMAC token is the auth; no Supabase JWT required)

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
    const valid = await crypto.subtle.verify(
      'HMAC', key, fromB64url(sigB64url), enc.encode(payload)
    )
    if (!valid) return null
    return { completionId, action, adminId }
  } catch {
    return null
  }
}
```

Validation fails silently on any exception. The caller maps `null` to the generic terminal page.

---

## State Transition Guarantee

The Edge Function **never directly updates `chore_completions`**. All state transitions go exclusively through the RPC functions:

- `approve_completion(completion_id)` — sole path to `status = 'approved'`
- `reject_completion(completion_id, reason)` — sole path to `status = 'rejected'`

This ensures coin crediting, in-app notifications, and `reviewed_by` audit fields run consistently regardless of whether the action came from the web app or the email button.

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/<timestamp>_email_action_log.sql` | New table + RLS policy |
| `supabase/functions/notify-admin-completion/index.ts` | Extract `id` + `photo_url`; generate per-admin HMAC tokens with `adminId`; photo block with alt/caption; same 7-day TTL for photo URL and tokens |
| `supabase/functions/handle-completion-action/index.ts` | New function — GET read-only confirmation, POST-only RPC + audit insert, classified error handling, indistinguishable terminal error pages |

## Out of Scope

- Custom reject reason from email (fixed reason used)
- Admin opt-out from email action buttons
- Verified physical identity of the actor (only intended recipient is recorded)
- Player notification email for rejection (in-app notification already handles it)
- Token revocation before expiry (RPC status check and 7-day TTL are sufficient)
- Mitigating email forwarding (accepted risk; this is the intended free-tier auth model)
