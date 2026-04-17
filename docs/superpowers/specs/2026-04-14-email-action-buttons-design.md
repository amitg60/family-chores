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
              ├─ Token invalid / expired / infra ────────→ Terminal: generic failure page
              ├─ Wrapper RPC throws "not pending" ────────→ Terminal: "הגשה זו כבר טופלה"
              ├─ Wrapper RPC throws unknown error ────────→ Terminal: generic failure page
              ├─ email_approve_completion() ──────────────→ (atomic: state + audit) → "✅ אושר"
              └─ email_reject_completion()  ──────────────→ (atomic: state + audit) → "❌ נדחה"
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

## Secret Management

`WEBHOOK_SECRET` must be stored as a Supabase Secret (Dashboard → Edge Functions → Manage secrets) and never committed to version control or stored in `.env` files in the repository.

**Rotation impact**: rotating `WEBHOOK_SECRET` immediately invalidates every outstanding HMAC token, including all unexpired tokens currently in admin inboxes. Any admin who has not yet clicked their email link will find it broken after rotation. Rotation must therefore only be performed when the secret is known or suspected to be compromised — not as a routine operation. Coordinate with all admins before rotating so they know to expect broken links and can approve or reject pending completions via the web app instead.

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
   - Inline JavaScript on the form's onsubmit: disable the button immediately on first click to
     prevent duplicate POST submissions (e.g., onsubmit="this.querySelector('button[type=submit]').disabled=true")
   - Button must meet a minimum touch target of 44 × 44 px (achieved via padding, not fixed size,
     so the label remains readable on all screen sizes)
```

**GET stops here. No RPC call. No audit write. No state change of any kind.**

The token travels from GET to POST via the form's `action` attribute query string. The token was already in the email (an authenticated channel), so embedding it in the form URL is not a new exposure. There are no hidden inputs — the token cannot be silently dropped.

### Step 2 — POST (execution)

The confirmation form submits a POST to the same URL with the token in the query string.

```
1. Parse and validate token (signature + expiry)
   → failure: return generic terminal page
2. Log: [EMAIL-ACTION] completionId=<uuid> action=<action> intended_recipient_id=<uuid>
3. Create Supabase service-role client
   → failure: log [INFRA] completionId=<uuid> intended_recipient_id=<uuid> client creation failed: <error>
              return generic terminal page
4. Call atomic wrapper RPC — no pre-check of completion status:
   - approve: supabase.rpc('email_approve_completion', { p_completion_id: completionId, p_admin_id: adminId })
   - reject:  supabase.rpc('email_reject_completion', { p_completion_id: completionId, p_admin_id: adminId,
                             p_reason: 'נדחה על ידי המנהל' })
   The wrapper RPC calls the underlying approve/reject RPC and inserts the audit row in the same
   Postgres transaction. Both commit or both roll back together.
   → throws "not pending": return "already actioned" terminal page
   → throws anything else: log [INFRA] completionId=<uuid> intended_recipient_id=<uuid>
                                       action=<action> rpc failed: <error>
                            return generic terminal page
5. Return success result page ("✅ ההגשה אושרה" or "❌ ההגשה נדחתה")
```

**POST does not pre-check completion status before calling the RPC.** It calls the wrapper directly and relies on the underlying RPC's atomic `status = 'pending'` guard. If the completion is already actioned, the inner RPC raises "not pending" — which propagates through the wrapper — and POST maps that exception to the "already actioned" page. This eliminates the TOCTOU race that a pre-check would introduce.

---

## Durable Audit Log

`email_action_log` is the source of truth for email-based actions. Function logs are secondary and supplementary. An operator investigating an email-triggered approve or reject must consult this table first.

### Schema (new migration)

```sql
-- Audit table
CREATE TABLE email_action_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id uuid        NOT NULL REFERENCES chore_completions(id),
  admin_id      uuid        NOT NULL REFERENCES profiles(id),
  action        text        NOT NULL CHECK (action IN ('approve', 'reject')),
  source        text        NOT NULL DEFAULT 'email',
  actioned_at   timestamptz NOT NULL DEFAULT now()
);

-- Index for fast audit lookups by completion
CREATE INDEX email_action_log_completion_id_idx ON email_action_log (completion_id);

ALTER TABLE email_action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read own rows"
  ON email_action_log FOR SELECT
  USING (admin_id = auth.uid());

-- Atomic wrapper: approve + audit in one transaction
CREATE OR REPLACE FUNCTION email_approve_completion(
  p_completion_id uuid,
  p_admin_id      uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM approve_completion(p_completion_id);
  INSERT INTO email_action_log (completion_id, admin_id, action, source)
  VALUES (p_completion_id, p_admin_id, 'approve', 'email');
END;
$$;

-- Atomic wrapper: reject + audit in one transaction
CREATE OR REPLACE FUNCTION email_reject_completion(
  p_completion_id uuid,
  p_admin_id      uuid,
  p_reason        text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM reject_completion(p_completion_id, p_reason);
  INSERT INTO email_action_log (completion_id, admin_id, action, source)
  VALUES (p_completion_id, p_admin_id, 'reject', 'email');
END;
$$;
```

`admin_id` is populated from the `adminId` field in the HMAC-signed token. It records the **intended recipient** of the email — not a verified claim about who physically clicked. Any UI or report displaying `admin_id` from this table must label it **"Intended Recipient"** to accurately reflect the security model's accepted risks regarding email forwarding.

### Atomicity

The `email_approve_completion` and `email_reject_completion` wrapper functions execute their state change and their audit insert inside the **same Postgres transaction**. Both commit or both roll back together. This eliminates any window between a committed state change and a missing audit row.

The `[EMAIL-ACTION]` console log line is written by the Edge Function before calling the wrapper, serving as a belt-and-suspenders record for operator correlation — it is no longer the primary audit source. The `email_action_log` table is the source of truth.

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
| Env var missing (`WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) | Generic terminal page | `[INFRA] missing env: <name>` (context unavailable — fires before token validation) |
| Supabase client creation throws | Generic terminal page | `[INFRA] completionId=<uuid> intended_recipient_id=<uuid> client creation failed: <error>` |
| DB status check fails (GET) | Generic terminal page | `[INFRA] completionId=<uuid> intended_recipient_id=<uuid> status check failed: <error>` |
| Wrapper RPC returns unexpected error | Generic terminal page | `[INFRA] completionId=<uuid> intended_recipient_id=<uuid> action=<action> rpc failed: <error>` |

Every `[INFRA]` log entry must include `completionId` and `intended_recipient_id` when they are available (i.e., after successful token validation). The key name `intended_recipient_id` is used instead of `adminId` so that the log entry self-documents the security model: the value identifies who received the email, not who physically acted. The env-missing case is the only exception — it fires at startup before any token is parsed, so those fields are genuinely unknown.

The `[EMAIL-ACTION]` pre-execution log line follows the same convention:
```
[EMAIL-ACTION] completionId=<uuid> action=approve|reject intended_recipient_id=<uuid>
```

**Service client creation is a distinct error case.** It is wrapped in a try/catch separate from the RPC call. Failure returns the generic terminal page immediately without attempting any DB access.

### Terminal page policy

All non-success terminal pages (token invalid, infra error) show the same generic message to the user:

> ⚠️ לא ניתן לבצע את הפעולה. [פתח את האפליקציה]({APP_URL})

The `{APP_URL}` placeholder is replaced at render time using the `APP_URL` environment variable. If `APP_URL` is not set, the link is omitted and the text reads "אנא פתח את האפליקציה" without a hyperlink. This gives the admin a path forward regardless of why the link failed.

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
     border="0"
     style="display:block;border:0;outline:none;text-decoration:none;max-width:100%;border-radius:8px;margin:16px 0;">
<p style="font-size:12px;color:#6b7280;margin:0 0 16px 0;">תמונת הוכחה לביצוע המשימה</p>
```

**All styles in the email HTML must be applied as inline CSS on the element itself** — no `<style>` blocks, no `<link>` stylesheets. Most email clients (including Gmail, Outlook, and Apple Mail) strip or ignore non-inline styles. Any style that is not on the element's `style` attribute will be silently lost for a significant share of recipients.

CSS notes for email client compatibility:
- `display:block` — eliminates the phantom bottom gap that inline images produce in some clients
- `border:0` — prevents Internet Explorer and old Outlook from adding a blue border when the image is inside an anchor
- `outline:none` — suppresses focus outlines added by some mobile email clients
- `text-decoration:none` — defensive rule in case the image is ever wrapped in a link
- Both the HTML attribute `border="0"` and the CSS `border:0` are required because older Outlook versions ignore CSS

Touch targets for email action buttons: the `<a>` anchor buttons for Approve and Reject must render at least 44 px tall. Achieve this with `padding: 14px 28px` applied as an inline `style` attribute on the anchor — do not use a fixed `height`, as some email clients strip it. A 44 × 44 px minimum follows Apple HIG and WCAG 2.5.5 guidelines for touch targets. All padding and sizing for these buttons must also be inline CSS — no external stylesheet or `<style>` block.

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

### Response headers

Every response from this function — confirmation page, result page, terminal page, and 400 — must include:

```
Cache-Control: no-store, max-age=0
Vary: *
```

`Cache-Control: no-store` prevents browsers and intermediaries from caching any page; `max-age=0` reinforces this for proxies that ignore `no-store`. `Vary: *` marks the response as uncacheable by shared caches regardless of request headers, preventing CDN or proxy layers from ever serving a stale confirmation or result page. Without these headers a browser may replay a cached "already actioned" page or re-submit a cached confirmation form.

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

**Constant-time comparison**: signature verification uses `crypto.subtle.verify`, which performs a constant-time byte comparison. Do not substitute a manual byte-by-byte or string equality check — those are vulnerable to timing attacks that allow an attacker to infer valid signature bytes by measuring response time differences.

---

## State Transition Guarantee

The Edge Function **never directly updates `chore_completions`**. For email-triggered actions it calls the atomic wrapper functions, which themselves delegate to the core RPCs:

- `email_approve_completion(p_completion_id, p_admin_id)` → calls `approve_completion` + inserts audit row atomically
- `email_reject_completion(p_completion_id, p_admin_id, p_reason)` → calls `reject_completion` + inserts audit row atomically

The underlying `approve_completion` and `reject_completion` RPCs remain the sole paths to `status = 'approved'` and `status = 'rejected'`. This ensures coin crediting, in-app notifications, and `reviewed_by` audit fields run consistently regardless of whether the action came from the web app or the email button.

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/<timestamp>_email_action_log.sql` | New table + RLS policy + index on `completion_id` + `email_approve_completion` and `email_reject_completion` wrapper functions |
| `supabase/functions/notify-admin-completion/index.ts` | Extract `id` + `photo_url`; generate per-admin HMAC tokens with `adminId`; photo block with alt/caption; same 7-day TTL for photo URL and tokens |
| `supabase/functions/handle-completion-action/index.ts` | New function — GET read-only confirmation, POST-only RPC + audit insert, classified error handling, indistinguishable terminal error pages |

## Out of Scope

- Custom reject reason from email (fixed reason used)
- Admin opt-out from email action buttons
- Verified physical identity of the actor (only intended recipient is recorded)
- Player notification email for rejection (in-app notification already handles it)
- Token revocation before expiry (RPC status check and 7-day TTL are sufficient)
- Mitigating email forwarding (accepted risk; this is the intended free-tier auth model)
