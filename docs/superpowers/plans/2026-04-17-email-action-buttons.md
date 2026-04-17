# Email Action Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the admin notification email with an inline proof photo and one-click Approve/Reject buttons that execute directly from the email via a two-step hosted confirmation page, with a durable atomic audit log.

**Architecture:** A new DB migration adds `email_action_log` table + two Postgres wrapper functions (`email_approve_completion`, `email_reject_completion`) that execute the state change and audit insert atomically. A new `handle-completion-action` Edge Function serves GET (confirmation page) and POST (action execution). The existing `notify-admin-completion` Edge Function is updated to embed per-admin HMAC tokens and a signed proof photo URL in each email.

**Tech Stack:** Supabase Edge Functions (Deno/TypeScript), Supabase Storage (signed URLs), Web Crypto API (HMAC-SHA256, constant-time verify), PostgreSQL (plpgsql wrapper functions), Resend (email), base64url encoding.

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `supabase/migrations/016_email_action_log.sql` | **Create** | Table, index, RLS, wrapper RPCs |
| `supabase/functions/notify-admin-completion/index.ts` | **Modify** | Add token generation + photo URL + new email template |
| `supabase/functions/handle-completion-action/index.ts` | **Create** | GET confirmation / POST execution / all HTML pages |

---

## Task 1: DB Migration — Audit Table + Wrapper Functions

**Files:**
- Create: `supabase/migrations/016_email_action_log.sql`

- [ ] **Step 1.1: Create the migration file**

```sql
-- supabase/migrations/016_email_action_log.sql

-- Audit table: source of truth for email-triggered actions
CREATE TABLE email_action_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  completion_id uuid        NOT NULL REFERENCES chore_completions(id),
  admin_id      uuid        NOT NULL REFERENCES profiles(id),
  action        text        NOT NULL CHECK (action IN ('approve', 'reject')),
  source        text        NOT NULL DEFAULT 'email',
  actioned_at   timestamptz NOT NULL DEFAULT now()
);

-- Fast lookups by completion
CREATE INDEX email_action_log_completion_id_idx ON email_action_log (completion_id);

-- Admins can only read their own rows; service role handles inserts via wrapper functions
ALTER TABLE email_action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read own rows"
  ON email_action_log FOR SELECT
  USING (admin_id = auth.uid());

-- Wrapper: approve + audit in a single Postgres transaction
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

-- Wrapper: reject + audit in a single Postgres transaction
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

- [ ] **Step 1.2: Push the migration to Supabase**

```bash
npx supabase db push
```

Expected: migration applies without error. If `supabase` is not available via npx, use the Supabase Dashboard SQL editor — paste the file contents and run.

- [ ] **Step 1.3: Verify the table and functions exist**

In Supabase Dashboard → Table Editor, confirm `email_action_log` appears with columns:
`id`, `completion_id`, `admin_id`, `action`, `source`, `actioned_at`.

In Dashboard → Database → Functions, confirm `email_approve_completion` and `email_reject_completion` exist.

- [ ] **Step 1.4: Commit**

```bash
git add supabase/migrations/016_email_action_log.sql
git commit -m "feat: add email_action_log table and atomic wrapper RPCs"
```

---

## Task 2: Update `notify-admin-completion` — Tokens + Photo + New Email Template

**Files:**
- Modify: `supabase/functions/notify-admin-completion/index.ts`

This task replaces the entire file. The key additions over the current version:
- `toB64url` helper and `generateToken` function
- Reads `id` and `photo_url` from the webhook payload
- Reads `WEBHOOK_SECRET` from env
- Generates a signed photo URL (same 7-day TTL as tokens)
- Generates per-admin approve + reject tokens
- New `buildAdminEmail` signature with photo + action button parameters

- [ ] **Step 2.1: Replace `notify-admin-completion/index.ts` with the updated implementation**

```typescript
// supabase/functions/notify-admin-completion/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

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

function buildAdminEmail(
  playerName: string,
  choreTitle: string,
  coinValue: number,
  approveUrl: string,
  rejectUrl: string,
  photoSignedUrl: string | null
): string {
  const photoBlock = photoSignedUrl ? `
  <img src="${escapeHtml(photoSignedUrl)}"
       alt="תמונת הוכחה שצולמה על ידי השחקן"
       width="400"
       border="0"
       style="display:block;border:0;outline:none;text-decoration:none;max-width:100%;border-radius:8px;margin:16px 0;">
  <p style="font-size:12px;color:#6b7280;margin:0 0 16px 0;">תמונת הוכחה לביצוע המשימה</p>` : ''

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="color:#1e1b4b;margin:0 0 12px 0;">📋 ${escapeHtml(playerName)} השלים/ה משימה</h2>
  <p style="margin:0 0 8px 0;">${escapeHtml(playerName)} השלים/ה את המשימה ״<strong>${escapeHtml(choreTitle)}</strong>״ ומחכה לאישורך.</p>
  <p style="margin:0 0 16px 0;">ערך המשימה: <strong>${coinValue} מטבעות</strong></p>
  ${photoBlock}
  <div style="margin-top:24px;">
    <a href="${escapeHtml(approveUrl)}"
       style="display:inline-block;background:#22c55e;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin-left:12px;font-size:1rem;">
      ✅ אשר
    </a>
    <a href="${escapeHtml(rejectUrl)}"
       style="display:inline-block;background:#ef4444;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:1rem;">
      ❌ דחה
    </a>
  </div>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const webhookSecret = req.headers.get('x-webhook-secret')
  if (webhookSecret !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const record = (payload as Record<string, unknown>).record as Record<string, unknown> | null
  if (
    !record ||
    typeof record.id !== 'string' || !record.id ||
    typeof record.completed_by !== 'string' ||
    typeof record.chore_assignment_id !== 'string'
  ) {
    return new Response('Invalid webhook payload', { status: 400 })
  }

  const completionId = record.id
  const photoUrl = typeof record.photo_url === 'string' ? record.photo_url : null

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('FROM_EMAIL')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const webhookSecretValue = Deno.env.get('WEBHOOK_SECRET')

  if (!resendApiKey || !fromEmail || !supabaseUrl || !supabaseServiceKey || !webhookSecretValue) {
    console.error('Missing required env vars')
    return new Response('Server misconfiguration', { status: 500 })
  }

  const actionBaseUrl = `${supabaseUrl}/functions/v1/handle-completion-action`
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('name, family_id')
    .eq('id', record.completed_by)
    .single()

  if (profileError || !profile) {
    console.error('Profile query failed:', profileError)
    return new Response('Profile not found', { status: 404 })
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('chore_assignments')
    .select('chores(title, coin_value)')
    .eq('id', record.chore_assignment_id)
    .single()

  if (assignmentError) {
    // Non-fatal: email sends with placeholder if assignment lookup fails
    console.error('Assignment query failed:', assignmentError)
  }

  const chore = assignment?.chores as { title: string; coin_value: number } | null | undefined

  // Generate photo signed URL with same 7-day TTL as action tokens
  let photoSignedUrl: string | null = null
  if (photoUrl) {
    const { data: signedData } = await supabase.storage
      .from('completion-photos')
      .createSignedUrl(photoUrl, 7 * 24 * 60 * 60)
    photoSignedUrl = signedData?.signedUrl ?? null
  }

  const { data: admins, error: adminsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('family_id', profile.family_id)
    .eq('role', 'admin')

  if (adminsError) {
    console.error('Admins query failed:', adminsError)
    return new Response('Failed to fetch admins', { status: 500 })
  }

  await Promise.all(
    (admins ?? []).map(async (admin) => {
      const { data: authData, error: authError } = await supabase.auth.admin.getUserById(admin.id)
      if (authError || !authData?.user?.email) return
      const adminEmail = authData.user.email

      // Each admin gets unique tokens embedding their profile ID
      const [approveToken, rejectToken] = await Promise.all([
        generateToken(completionId, 'approve', admin.id, webhookSecretValue),
        generateToken(completionId, 'reject', admin.id, webhookSecretValue),
      ])
      const approveUrl = `${actionBaseUrl}?token=${approveToken}`
      const rejectUrl = `${actionBaseUrl}?token=${rejectToken}`

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: adminEmail,
          subject: `📋 ${profile.name} השלים/ה את המשימה ״${chore?.title ?? 'משימה'}״`,
          html: buildAdminEmail(
            profile.name,
            chore?.title ?? 'משימה',
            chore?.coin_value ?? 0,
            approveUrl,
            rejectUrl,
            photoSignedUrl
          ),
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        console.error(`Resend error for ${adminEmail}: ${res.status} ${body}`)
      } else {
        console.log(`Admin notification sent to ${adminEmail}`)
      }
    })
  )

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 2.2: Deploy the updated function**

```bash
npx supabase functions deploy notify-admin-completion
```

Expected output ends with: `Deployed Function notify-admin-completion`

- [ ] **Step 2.3: Smoke-test by submitting a completion as a player**

Log in as a player, submit a completion proof. Check the admin's email:
- Subject should start with `📋` not `✅`
- Email should contain two buttons: `✅ אשר` and `❌ דחה`
- If the completion had a photo, the proof image should appear inline
- Both button URLs should contain `?token=` with a long base64url token

Check the Edge Function log in Supabase Dashboard → Edge Functions → `notify-admin-completion` → Logs to confirm `Admin notification sent to <email>`.

- [ ] **Step 2.4: Commit**

```bash
git add supabase/functions/notify-admin-completion/index.ts
git commit -m "feat: add per-admin HMAC tokens and proof photo to admin notification email"
```

---

## Task 3: Create `handle-completion-action` Edge Function

**Files:**
- Create: `supabase/functions/handle-completion-action/index.ts`

- [ ] **Step 3.1: Create the directory and file**

```bash
mkdir -p supabase/functions/handle-completion-action
```

- [ ] **Step 3.2: Write the Edge Function**

```typescript
// supabase/functions/handle-completion-action/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// --- base64url helpers ---

function toB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(s.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

// --- token validation ---
// crypto.subtle.verify performs constant-time comparison — do not substitute string equality

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

// --- response headers: no caching, no stale state ---

const BASE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'Vary': '*',
}

// --- HTML page builders ---

function htmlPage(body: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ביצוע פעולה</title>
</head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:32px;max-width:480px;margin:40px auto;">
  ${body}
</body>
</html>`
}

function terminalPage(appUrl: string): Response {
  const link = appUrl
    ? `<a href="${appUrl}" style="color:#6366f1;text-decoration:underline;">פתח את האפליקציה</a>`
    : 'אנא פתח את האפליקציה'
  return new Response(
    htmlPage(`<p style="font-size:1.2rem;color:#374151;">⚠️ לא ניתן לבצע את הפעולה. ${link}</p>`),
    { headers: BASE_HEADERS }
  )
}

function alreadyActionedPage(): Response {
  return new Response(
    htmlPage(`<p style="font-size:1.2rem;color:#374151;">ℹ️ הגשה זו כבר טופלה.</p>`),
    { headers: BASE_HEADERS }
  )
}

function confirmationPage(token: string, action: string): Response {
  const isApprove = action === 'approve'
  const heading = isApprove
    ? 'אתה עומד לאשר את ההגשה.'
    : 'אתה עומד לדחות את ההגשה.'
  const btnLabel = isApprove ? 'אשר' : 'דחה'
  const btnColor = isApprove ? '#22c55e' : '#ef4444'
  // Token passed in form action URL — already in an authenticated channel (email)
  // onsubmit disables button immediately to prevent duplicate POST submissions
  return new Response(
    htmlPage(`
      <h2 style="color:#1e1b4b;margin:0 0 24px 0;">${heading}</h2>
      <form method="POST" action="?token=${encodeURIComponent(token)}"
            onsubmit="this.querySelector('button[type=submit]').disabled=true">
        <button type="submit"
                style="background:${btnColor};color:white;padding:14px 28px;border:none;border-radius:8px;font-size:1.1rem;font-weight:bold;cursor:pointer;min-height:44px;min-width:44px;">
          ${btnLabel}
        </button>
      </form>
    `),
    { headers: BASE_HEADERS }
  )
}

function successPage(action: string): Response {
  const msg = action === 'approve'
    ? '✅ ההגשה אושרה בהצלחה. השחקן יקבל את המטבעות.'
    : '❌ ההגשה נדחתה.'
  return new Response(
    htmlPage(`<p style="font-size:1.2rem;color:#374151;">${msg}</p>`),
    { headers: BASE_HEADERS }
  )
}

// --- main handler ---

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return new Response('missing token', { status: 400, headers: BASE_HEADERS })
  }

  const webhookSecret = Deno.env.get('WEBHOOK_SECRET')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const appUrl = Deno.env.get('APP_URL') ?? ''

  if (!webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error('[INFRA] missing env: WEBHOOK_SECRET or SUPABASE_SERVICE_ROLE_KEY')
    return terminalPage(appUrl)
  }

  const parsed = await validateToken(token, webhookSecret)
  if (!parsed) {
    return terminalPage(appUrl)
  }
  const { completionId, action, adminId } = parsed

  // ── GET: read-only — render confirmation page or terminal page ──────────────

  if (req.method === 'GET') {
    let supabase
    try {
      supabase = createClient(supabaseUrl, supabaseServiceKey)
    } catch (err) {
      console.error(`[INFRA] completionId=${completionId} intended_recipient_id=${adminId} client creation failed: ${err}`)
      return terminalPage(appUrl)
    }

    const { data: completion, error: statusError } = await supabase
      .from('chore_completions')
      .select('status')
      .eq('id', completionId)
      .single()

    if (statusError) {
      console.error(`[INFRA] completionId=${completionId} intended_recipient_id=${adminId} status check failed: ${statusError.message}`)
      return terminalPage(appUrl)
    }

    if (!completion || completion.status !== 'pending') {
      return alreadyActionedPage()
    }

    return confirmationPage(token, action)
  }

  // ── POST: execute action — only step that calls RPC or writes audit row ─────

  if (req.method === 'POST') {
    console.log(`[EMAIL-ACTION] completionId=${completionId} action=${action} intended_recipient_id=${adminId}`)

    let supabase
    try {
      supabase = createClient(supabaseUrl, supabaseServiceKey)
    } catch (err) {
      console.error(`[INFRA] completionId=${completionId} intended_recipient_id=${adminId} client creation failed: ${err}`)
      return terminalPage(appUrl)
    }

    const rpcName = action === 'approve' ? 'email_approve_completion' : 'email_reject_completion'
    const rpcArgs = action === 'approve'
      ? { p_completion_id: completionId, p_admin_id: adminId }
      : { p_completion_id: completionId, p_admin_id: adminId, p_reason: 'נדחה על ידי המנהל' }

    const { error: rpcError } = await supabase.rpc(rpcName, rpcArgs)

    if (rpcError) {
      if (rpcError.message.includes('not pending')) {
        return alreadyActionedPage()
      }
      console.error(`[INFRA] completionId=${completionId} intended_recipient_id=${adminId} action=${action} rpc failed: ${rpcError.message}`)
      return terminalPage(appUrl)
    }

    return successPage(action)
  }

  return new Response('Method not allowed', { status: 405, headers: BASE_HEADERS })
})
```

- [ ] **Step 3.3: Deploy with `--no-verify-jwt`**

```bash
npx supabase functions deploy handle-completion-action --no-verify-jwt
```

Expected output ends with: `Deployed Function handle-completion-action`

- [ ] **Step 3.4: Smoke-test the GET handler with a token from a real email**

Open the ✅ אשר or ❌ דחה link from the email that arrived in Task 2 step 2.3. You should see a confirmation page in Hebrew with either an "אשר" (green) or "דחה" (red) button.

Expected:
- Page shows Hebrew text describing the action
- One large button (≥44 px tall) with appropriate color
- URL in the browser address bar contains `?token=...`

- [ ] **Step 3.5: Smoke-test the POST handler by clicking the confirm button**

Click the confirm button on the confirmation page. You should see the result page.

For an **approve** action:
- Page shows: `✅ ההגשה אושרה בהצלחה. השחקן יקבל את המטבעות.`
- In Supabase Dashboard → Table Editor → `chore_completions`, the row status = `approved`
- In Dashboard → Table Editor → `email_action_log`, a new row with `action = 'approve'` and `source = 'email'`

For a **reject** action:
- Page shows: `❌ ההגשה נדחתה.`
- `chore_completions` status = `rejected`
- `email_action_log` row with `action = 'reject'`

- [ ] **Step 3.6: Smoke-test already-actioned response**

Click either button a second time (or use the same link again). Expected on GET: page shows `ℹ️ הגשה זו כבר טופלה.` No new row in `email_action_log`.

- [ ] **Step 3.7: Smoke-test generic failure page**

Open any of these URLs in a browser to verify the generic failure page:
- URL with missing token: `https://<ref>.supabase.co/functions/v1/handle-completion-action`
  → Expected: HTTP 400, plain text `missing token`
- URL with a corrupted token: `https://<ref>.supabase.co/functions/v1/handle-completion-action?token=invalid`
  → Expected: page shows `⚠️ לא ניתן לבצע את הפעולה.` with a link (if APP_URL is set) or plain text

- [ ] **Step 3.8: Commit**

```bash
git add supabase/functions/handle-completion-action/index.ts
git commit -m "feat: add handle-completion-action edge function with GET/POST two-step flow"
```

---

## Task 4: End-to-End Verification

- [ ] **Step 4.1: Verify the full flow with a fresh completion**

1. Log in as a player. Submit a new completion with a proof photo.
2. Check admin email inbox. Verify:
   - Email subject starts with `📋`
   - Proof photo renders inline (not broken)
   - Two buttons present: `✅ אשר` and `❌ דחה`
3. Click `✅ אשר`. Verify confirmation page loads with "אתה עומד לאשר את ההגשה".
4. Click the "אשר" button. Verify result page shows `✅ ההגשה אושרה בהצלחה. השחקן יקבל את המטבעות.`
5. In Supabase Dashboard:
   - `chore_completions` row: `status = approved`, `reviewed_by = NULL` (expected for email-based actions)
   - `email_action_log` row: `action = approve`, `source = email`, `admin_id` = the admin's profile UUID

- [ ] **Step 4.2: Verify reject flow with a fresh completion**

1. Submit another completion as a player.
2. In admin email, click `❌ דחה`. Confirm page shows "אתה עומד לדחות את ההגשה".
3. Click "דחה". Verify `❌ ההגשה נדחתה.`
4. In Supabase Dashboard:
   - `chore_completions` row: `status = rejected`
   - `email_action_log` row: `action = reject`, `source = email`

- [ ] **Step 4.3: Verify Edge Function logs in Supabase Dashboard**

Dashboard → Edge Functions → `handle-completion-action` → Logs.

For the approve action: confirm a line matching:
```
[EMAIL-ACTION] completionId=<uuid> action=approve intended_recipient_id=<uuid>
```

- [ ] **Step 4.4: Final commit**

```bash
git add -A
git commit -m "feat: email action buttons complete — photo, approve/reject, audit log"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Inline proof photo in email — Task 2 (`photoBlock` in `buildAdminEmail`)
- ✅ Per-admin HMAC tokens (7-day expiry, approve + reject) — Task 2 (`generateToken`)
- ✅ Two-step GET/POST flow — Task 3 (GET confirmation, POST execution)
- ✅ GET read-only, no state change — Task 3 (GET returns `confirmationPage`, no RPC)
- ✅ POST calls atomic wrapper RPC — Task 3 (`email_approve_completion` / `email_reject_completion`)
- ✅ Durable audit log (`email_action_log`) — Task 1 (table + wrapper functions)
- ✅ Token in form action URL, not hidden input — Task 3 (`confirmationPage` form action)
- ✅ Button disabled on submit — Task 3 (`onsubmit` handler)
- ✅ Cache-Control + Vary headers — Task 3 (`BASE_HEADERS`)
- ✅ Indistinguishable terminal error pages — Task 3 (`terminalPage` used for all non-business errors)
- ✅ Already-actioned on GET (DB status check) — Task 3 GET handler
- ✅ Already-actioned on POST (RPC "not pending" mapping) — Task 3 POST handler
- ✅ `[EMAIL-ACTION]` + `[INFRA]` log format with `intended_recipient_id` — Task 3 POST handler
- ✅ Constant-time HMAC verify — Task 3 (`validateToken` uses `crypto.subtle.verify`)
- ✅ base64url encoding (URL-safe, no padding) — Task 2 + Task 3 (`toB64url`/`fromB64url`)
- ✅ Photo signed URL same TTL as tokens — Task 2 (`createSignedUrl` with `7 * 24 * 60 * 60`)
- ✅ All email styles inline — Task 2 (all `style=` attributes, no `<style>` block)
- ✅ 44px touch targets — Task 2 (buttons `padding:14px 28px`) + Task 3 (`min-height:44px`)
- ✅ Photo alt + caption fallback — Task 2 (`alt=` + `<p>` caption)
- ✅ Index on `email_action_log.completion_id` — Task 1 migration
- ✅ APP_URL fallback on generic failure page — Task 3 (`terminalPage` renders link or plain text)
