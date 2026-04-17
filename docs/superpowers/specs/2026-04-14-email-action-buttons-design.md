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
  → clicks Approve / Reject
        │
        ▼
handle-completion-action?token=<signed-token>
        │
        ├─ Invalid/expired  → "הקישור אינו תקף או פג תוקפו"
        ├─ Already actioned → "הגשה זו כבר טופלה"
        ├─ Approve          → approve_completion() → "✅ ההגשה אושרה"
        └─ Reject           → reject_completion()  → "❌ ההגשה נדחתה"
```

### Token Format

HMAC-SHA256 signed, base64-encoded:

```
base64url( completionId:action:expiry ) + "." + base64url( hmac-sha256( completionId:action:expiry, WEBHOOK_SECRET ) )
```

- `action`: `"approve"` or `"reject"`
- `expiry`: Unix timestamp (now + 7 days)
- Signed with existing `WEBHOOK_SECRET` — no new secret needed
- An approve token cannot be used to reject (action is part of the signed payload)

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

Validate that `id` is a string; `photo_url` can be null (no photo submitted).

### Photo signed URL

If `photo_url` is present, generate a signed URL via:

```typescript
const { data: signedData } = await supabase.storage
  .from('completion-photos')
  .createSignedUrl(record.photo_url, 7 * 24 * 60 * 60) // 7 days
```

Embed in email HTML as `<img src="signedUrl">`. Omit the image block entirely if `photo_url` is null.

### HMAC token generation

```typescript
async function generateToken(completionId: string, action: 'approve' | 'reject', secret: string): Promise<string> {
  const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  const payload = `${completionId}:${action}:${expiry}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return btoa(payload) + '.' + sigB64
}
```

### Updated email template

```
[שם השחקן] השלים/ה את המשימה ״[שם המשימה]״ ומחכה לאישורך.
ערך המשימה: [X] מטבעות

[תמונת הוכחה — inline img, max-width 400px, omitted if no photo]

[✅ אשר]   [❌ דחה]
```

Both buttons link to:
```
https://<ref>.supabase.co/functions/v1/handle-completion-action?token=<signed-token>
```

The CTA link to the app URL is removed — the email is now self-contained.

## New Edge Function: `handle-completion-action`

**File**: `supabase/functions/handle-completion-action/index.ts`

**Trigger**: HTTP GET from admin clicking email button (no webhook, no JWT required — deploy with `--no-verify-jwt`)

### Steps

1. Read `token` from query string → 400 if missing
2. Validate HMAC token (signature + expiry) → return "invalid/expired" HTML page if invalid
3. Extract `completionId` and `action` from token
4. Create Supabase client with service role key
5. If `action === 'approve'`: call `approve_completion(completionId)`
6. If `action === 'reject'`: call `reject_completion(completionId, 'נדחה על ידי המנהל')`
7. Return appropriate Hebrew HTML result page

### Token validation

```typescript
async function validateToken(token: string, secret: string): Promise<{ completionId: string; action: string } | null> {
  try {
    const [payloadB64, sigB64] = token.split('.')
    if (!payloadB64 || !sigB64) return null
    const payload = atob(payloadB64)
    const [completionId, action, expiryStr] = payload.split(':')
    if (!completionId || !action || !expiryStr) return null
    if (Math.floor(Date.now() / 1000) > parseInt(expiryStr)) return null
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload))
    if (!valid) return null
    return { completionId, action }
  } catch {
    return null
  }
}
```

### Result pages

All pages return `Content-Type: text/html` with status 200.

| Outcome | Hebrew message |
|---------|---------------|
| Approved | ✅ ההגשה אושרה בהצלחה! השחקן יקבל את המטבעות. |
| Rejected | ❌ ההגשה נדחתה. |
| Already actioned | ℹ️ הגשה זו כבר טופלה. |
| Expired / invalid | ⚠️ הקישור אינו תקף או פג תוקפו. אנא פתח את האפליקציה לאישור ידני. |

All pages: plain Hebrew HTML, `dir="rtl"`, no JS, mobile-friendly, no login required.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/notify-admin-completion/index.ts` | Extract `id` + `photo_url`, generate signed photo URL, generate HMAC tokens, update email template |
| `supabase/functions/handle-completion-action/index.ts` | New function — validate token, call RPC, return Hebrew HTML |

## Out of Scope

- Custom reject reason from email (fixed reason used)
- Token invalidation on use (idempotent RPCs handle double-click)
- Admin authentication for the action endpoint (token is the auth)
- Notify player by email when rejected via email button (in-app notification handles it)
