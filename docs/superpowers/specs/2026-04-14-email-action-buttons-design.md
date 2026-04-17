# Email Action Buttons & Proof Photo Design Spec

**Date**: 2026-04-14
**Status**: Approved

## Overview

Enhance the admin notification email to show the player's proof photo inline and include one-click Approve / Reject buttons that act directly from the email without requiring the admin to open the web app.

## Scope

- Inline proof photo in admin notification email
- One-click Approve button (HMAC-signed token, 7-day expiry)
- One-click Reject button (fixed reason: "נדחה על ידי המנהל")
- Simple Hebrew result page after button click
- No new DB migrations, no new secrets, no frontend changes

## Architecture

```
Admin receives email
  → sees proof photo inline
  → clicks Approve / Reject button (GET)
        │
        ▼
handle-completion-action?token=<signed-token>  (GET)
        │
        ├─ Invalid/expired  → "הקישור אינו תקף או פג תוקפו" (HTML, no form)
        └─ Valid token      → Confirmation HTML page with hidden form
                                  │
                                  └─ Admin clicks confirm button (POST)
                                          │
                                          ├─ Already actioned → "הגשה זו כבר טופלה"
                                          ├─ Approve          → approve_completion() → "✅ ההגשה אושרה"
                                          └─ Reject           → reject_completion()  → "❌ ההגשה נדחתה"
```

### Two-Step Flow (Link Prefetch Protection)

Email clients such as Gmail Safe Browsing and Outlook ATP pre-fetch links before the user sees or clicks them. A single-step GET that calls the RPC would trigger approvals/rejections automatically.

**Mitigation**: `handle-completion-action` implements a two-step flow:

- **GET** — validates the token and returns a confirmation HTML page. The page contains a `<form method="POST">` with the token in a hidden field and a single submit button ("אשר" or "דחה"). No state change occurs on GET.
- **POST** — validates the token again, calls the RPC, returns the result page. Only this step mutates state.

Pre-fetchers only send GET requests and will never trigger the POST. The confirmation page is the only thing they see.

### Token Format

**Encoding**: base64url (RFC 4648 §5 — URL-safe alphabet, no padding). Payload encoded as UTF-8 before signing.

```
<payloadB64url>.<sigB64url>
```

where:
```
payload      = completionId + ":" + action + ":" + expiry
payloadB64url = base64url( UTF-8(payload) )
sig          = HMAC-SHA256( UTF-8(payload), UTF-8(WEBHOOK_SECRET) )
sigB64url    = base64url( sig )
```

- `completionId`: UUID string
- `action`: `"approve"` or `"reject"`
- `expiry`: Unix timestamp as decimal integer (now + 604800 seconds)
- Signed with existing `WEBHOOK_SECRET` — no new secret needed
- An approve token cannot be used to reject (action is part of the signed payload)

**Helper** (shared by both functions):

```typescript
function toBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromBase64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}
```

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Email link pre-fetching (Gmail Safe Browsing, Outlook ATP) | Two-step flow — GET returns confirmation page only; POST executes RPC |
| Token forgery | HMAC-SHA256 with WEBHOOK_SECRET; forgery requires secret knowledge |
| Token replay after expiry | Expiry timestamp validated on every request (GET and POST) |
| Cross-action substitution (use approve token to reject) | `action` is inside the signed payload; any modification invalidates the HMAC |
| Token replay before expiry (double-click) | RPC checks `status = 'pending'` atomically; second call returns "already actioned" |
| Brute-force token guessing | 256-bit HMAC signature makes guessing computationally infeasible |

## Idempotency and Replay

Tokens are **not** invalidated on first use. The RPC functions are the sole source of truth:

- `approve_completion` raises an exception if `status <> 'pending'`
- `reject_completion` raises an exception if `status <> 'pending'`

A second POST with the same valid token will hit the RPC's status check and return the "already actioned" page. This is intentional — it handles double-click gracefully without needing a token store.

## State Transitions

The Edge Function **never directly updates `chore_completions`**. All state transitions go through the RPC functions exclusively:

- `approve_completion(completion_id)` — sole path to `status = 'approved'`
- `reject_completion(completion_id, reason)` — sole path to `status = 'rejected'`

This ensures the business logic (coin credit, notification triggers, `reviewed_by` audit field) runs consistently regardless of whether the action originated from the web app or the email button.

## Audit Trail

`approve_completion` and `reject_completion` set `reviewed_by = auth.uid()`. When called from the Edge Function with the service role key, there is no auth context, so `reviewed_by` will be **NULL** for email-based actions.

To compensate, the Edge Function logs each action to stdout before calling the RPC:

```
[ACTION] completionId=<uuid> action=approve|reject
```

Supabase Edge Function logs are retained and searchable in the Supabase Dashboard, providing an operational audit trail. No schema change is required.

## Error / Result Matrix

| Condition | GET response | POST response |
|-----------|-------------|--------------|
| `token` query param missing | 400 plain text | 400 plain text |
| Token malformed (can't parse) | "invalid/expired" HTML | "invalid/expired" HTML |
| HMAC signature invalid | "invalid/expired" HTML | "invalid/expired" HTML |
| Token expired | "invalid/expired" HTML | "invalid/expired" HTML |
| Valid token, action=approve | Approve confirmation page | ✅ "ההגשה אושרה בהצלחה" |
| Valid token, action=reject | Reject confirmation page | ❌ "ההגשה נדחתה" |
| Valid token, completion already actioned | Approve/reject confirmation page | ℹ️ "הגשה זו כבר טופלה" |
| RPC error (unexpected) | — | ⚠️ "אירעה שגיאה. אנא נסה שוב מאוחר יותר." |

All responses are `Content-Type: text/html`, status 200 (except 400 for missing token).

## Changes to `notify-admin-completion`

### Payload changes

Extract two additional fields from `payload.record`:

```typescript
const record = payload.record as {
  id: string                    // NEW — completion ID for token generation
  completed_by: string
  chore_assignment_id: string
  photo_url: string | null      // NEW — storage path for signed URL
}
```

Validate that `id` is a non-empty string; `photo_url` can be null (no photo submitted).

### Photo signed URL

If `photo_url` is present, generate a signed URL via:

```typescript
const { data: signedData } = await supabase.storage
  .from('completion-photos')
  .createSignedUrl(record.photo_url, 7 * 24 * 60 * 60) // 7 days
```

Embed in email HTML as `<img src="signedUrl">`. Omit the image block entirely if `photo_url` is null or `signedData` is null.

### HMAC token generation

```typescript
async function generateToken(completionId: string, action: 'approve' | 'reject', secret: string): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  const payload = `${completionId}:${action}:${expiry}`
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return toBase64url(enc.encode(payload)) + '.' + toBase64url(new Uint8Array(sig))
}
```

### Updated email template

```
[שם השחקן] השלים/ה את המשימה ״[שם המשימה]״ ומחכה לאישורך.
ערך המשימה: [X] מטבעות

[תמונת הוכחה — inline img, max-width 400px, omitted if no photo]

[✅ אשר]   [❌ דחה]
```

Both buttons are anchor tags linking to (GET):
```
https://<ref>.supabase.co/functions/v1/handle-completion-action?token=<signed-token>
```

The CTA link to the app URL is removed — the email is now self-contained.

## New Edge Function: `handle-completion-action`

**File**: `supabase/functions/handle-completion-action/index.ts`

**Trigger**: HTTP GET (email click) or POST (confirmation form submit). Deploy with `--no-verify-jwt`.

### GET handler

1. Read `token` from query string → 400 if missing
2. Validate HMAC token (signature + expiry) → return "invalid/expired" HTML page if invalid
3. Extract `action` from token payload
4. Return confirmation HTML page with:
   - Hebrew description of the action about to be taken
   - `<form method="POST" action="?token=<token>">` with a single submit button

### POST handler

1. Read `token` from query string → 400 if missing
2. Validate HMAC token (signature + expiry) → return "invalid/expired" HTML page if invalid
3. Extract `completionId` and `action` from token
4. Log: `console.log('[ACTION] completionId=' + completionId + ' action=' + action)`
5. Create Supabase client with service role key
6. If `action === 'approve'`: call `approve_completion(completionId)`
7. If `action === 'reject'`: call `reject_completion(completionId, 'נדחה על ידי המנהל')`
8. If RPC error message includes "not pending": return "already actioned" page
9. If RPC error (other): return generic error page
10. Return success result page

### Token validation

```typescript
async function validateToken(token: string, secret: string): Promise<{ completionId: string; action: string } | null> {
  try {
    const [payloadB64url, sigB64url] = token.split('.')
    if (!payloadB64url || !sigB64url) return null
    const payloadBytes = fromBase64url(payloadB64url)
    const payload = new TextDecoder().decode(payloadBytes)
    const [completionId, action, expiryStr] = payload.split(':')
    if (!completionId || !action || !expiryStr) return null
    if (Math.floor(Date.now() / 1000) > parseInt(expiryStr, 10)) return null
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sigBytes = fromBase64url(sigB64url)
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload))
    if (!valid) return null
    return { completionId, action }
  } catch {
    return null
  }
}
```

### Result pages

All pages return `Content-Type: text/html`, status 200. All are plain Hebrew HTML, `dir="rtl"`, no JS, mobile-friendly, no login required.

| Outcome | Hebrew message |
|---------|---------------|
| Approved | ✅ ההגשה אושרה בהצלחה! השחקן יקבל את המטבעות. |
| Rejected | ❌ ההגשה נדחתה. |
| Already actioned | ℹ️ הגשה זו כבר טופלה. |
| Expired / invalid | ⚠️ הקישור אינו תקף או פג תוקפו. אנא פתח את האפליקציה לאישור ידני. |
| Unexpected RPC error | ⚠️ אירעה שגיאה. אנא נסה שוב מאוחר יותר. |

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/notify-admin-completion/index.ts` | Extract `id` + `photo_url`, generate signed photo URL, generate HMAC tokens, update email template |
| `supabase/functions/handle-completion-action/index.ts` | New function — two-step GET/POST flow, validate token, call RPC, return Hebrew HTML |

## Out of Scope

- Custom reject reason from email (fixed reason used)
- Token invalidation on use (idempotent RPCs handle double-click)
- Admin authentication for the action endpoint (token is the auth)
- Notify player by email when rejected via email button (in-app notification handles it)
- Persisting `reviewed_by` for email-based actions (console.log audit trail used instead)
