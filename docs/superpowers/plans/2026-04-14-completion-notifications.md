# Completion Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send email notifications to admins when a player submits a completion, and to players (who have an email) when their completion is approved.

**Architecture:** Two Supabase Edge Functions (Deno) triggered by database webhooks on `chore_completions`. Admin email fires on INSERT; player email fires on UPDATE where status changes from `pending` → `approved`. Email delivery via Resend free tier. A minor UI fix in `CompletionsPage.tsx` handles the case where two admins race to approve the same completion.

**Tech Stack:** Supabase Edge Functions (Deno), Resend API (free), Vitest + React Testing Library (UI fix test)

---

### Task 1: Install Supabase CLI and link project

**Files:**
- No files changed

- [ ] **Step 1: Install Scoop (Windows package manager)**

Open PowerShell as a regular user (NOT as admin) and run:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
```
Close and reopen your terminal after this completes.

- [ ] **Step 2: Install Supabase CLI via Scoop**

```bash
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

- [ ] **Step 3: Verify installation**

```bash
supabase --version
```
Expected output: a version number, e.g. `2.x.x`

- [ ] **Step 4: Log in to Supabase**

```bash
supabase login
```
A browser window opens. Sign in with your Supabase account. Terminal should show: `You are now logged in.`

- [ ] **Step 5: Link the project**

```bash
cd D:/Claude_Projects/family-chores
supabase link
```
Select `family-chores` from the list when prompted. Expected: `Finished supabase link.`

---

### Task 2: Set up Resend and configure all secrets

**Files:**
- No files changed

- [ ] **Step 1: Create a Resend account**

Go to resend.com → sign up free → verify your email address.

- [ ] **Step 2: Create an API key**

In the Resend dashboard: **API Keys** → **Create API Key** → name it `family-chores` → **Full access** → **Create**.
Copy the key immediately (starts with `re_`). It won't be shown again.

- [ ] **Step 3: Set all secrets via Supabase CLI**

```bash
cd D:/Claude_Projects/family-chores
supabase secrets set RESEND_API_KEY=re_YOUR_KEY_HERE
supabase secrets set WEBHOOK_SECRET=3d59e8d9e35c91ad94352a3d78fa361bc3addcf3116961762e48c9f518de7614
supabase secrets set FROM_EMAIL=onboarding@resend.dev
supabase secrets set APP_URL=https://YOUR_APP.vercel.app
```

Replace `re_YOUR_KEY_HERE` with the key from Step 2.
Replace `https://YOUR_APP.vercel.app` with your actual Vercel deployment URL.

`FROM_EMAIL`: use `onboarding@resend.dev` for now — it works without domain verification. When ready for production, verify your own domain in Resend and update this secret to `noreply@yourdomain.com`.

- [ ] **Step 4: Verify secrets are set**

```bash
supabase secrets list
```
Expected: all four keys listed (values are hidden).

---

### Task 3: Create notify-admin-completion Edge Function

**Files:**
- Create: `supabase/functions/notify-admin-completion/index.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p D:/Claude_Projects/family-chores/supabase/functions/notify-admin-completion
```

- [ ] **Step 2: Create the Edge Function**

Create `supabase/functions/notify-admin-completion/index.ts` with this content:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const webhookSecret = req.headers.get('x-webhook-secret')
  if (webhookSecret !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 })
  }

  const payload = await req.json()
  const record = payload.record as {
    completed_by: string
    chore_assignment_id: string
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, family_id')
    .eq('id', record.completed_by)
    .single()

  if (!profile) {
    return new Response('Profile not found', { status: 404 })
  }

  const { data: assignment } = await supabase
    .from('chore_assignments')
    .select('chores(title, coin_value)')
    .eq('id', record.chore_assignment_id)
    .single()

  const chore = assignment?.chores as { title: string; coin_value: number } | null

  const { data: admins } = await supabase
    .from('profiles')
    .select('id')
    .eq('family_id', profile.family_id)
    .eq('role', 'admin')

  const appUrl = Deno.env.get('APP_URL') ?? ''
  const resendApiKey = Deno.env.get('RESEND_API_KEY')!
  const fromEmail = Deno.env.get('FROM_EMAIL')!

  for (const admin of admins ?? []) {
    const { data: authData } = await supabase.auth.admin.getUserById(admin.id)
    const adminEmail = authData.user?.email
    if (!adminEmail) continue

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: adminEmail,
        subject: `✅ ${profile.name} השלים/ה את המשימה ״${chore?.title ?? 'משימה'}״`,
        html: buildAdminEmail(profile.name, chore?.title ?? 'משימה', chore?.coin_value ?? 0, appUrl),
      }),
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

function buildAdminEmail(playerName: string, choreTitle: string, coinValue: number, appUrl: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="color:#1e1b4b;">✅ ${playerName} השלים/ה משימה</h2>
  <p>${playerName} השלים/ה את המשימה ״<strong>${choreTitle}</strong>״ ומחכה לאישורך.</p>
  <p>ערך המשימה: <strong>${coinValue} מטבעות</strong></p>
  <a href="${appUrl}"
     style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px;font-weight:bold;">
    לאישור ההגשה ←
  </a>
</body>
</html>`
}
```

- [ ] **Step 3: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add supabase/functions/notify-admin-completion/index.ts
git commit -m "feat: add notify-admin-completion edge function"
```

---

### Task 4: Create notify-player-approval Edge Function

**Files:**
- Create: `supabase/functions/notify-player-approval/index.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p D:/Claude_Projects/family-chores/supabase/functions/notify-player-approval
```

- [ ] **Step 2: Create the Edge Function**

Create `supabase/functions/notify-player-approval/index.ts` with this content:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const webhookSecret = req.headers.get('x-webhook-secret')
  if (webhookSecret !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 })
  }

  const payload = await req.json()
  const newRecord = payload.record as {
    completed_by: string
    chore_assignment_id: string
    status: string
  }
  const oldRecord = payload.old_record as { status: string }

  // Only proceed if this specific transition: pending → approved
  if (newRecord.status !== 'approved' || oldRecord.status !== 'pending') {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Check if player has an auth email — skip silently if not
  const { data: authData } = await supabase.auth.admin.getUserById(newRecord.completed_by)
  const playerEmail = authData.user?.email
  if (!playerEmail) {
    return new Response(JSON.stringify({ ok: true, skipped: 'no email' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', newRecord.completed_by)
    .single()

  const { data: assignment } = await supabase
    .from('chore_assignments')
    .select('chores(title, coin_value)')
    .eq('id', newRecord.chore_assignment_id)
    .single()

  const chore = assignment?.chores as { title: string; coin_value: number } | null
  const appUrl = Deno.env.get('APP_URL') ?? ''
  const resendApiKey = Deno.env.get('RESEND_API_KEY')!
  const fromEmail = Deno.env.get('FROM_EMAIL')!

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: playerEmail,
      subject: `🎉 הגשתך אושרה! קיבלת ${chore?.coin_value ?? 0} מטבעות`,
      html: buildPlayerEmail(
        profile?.name ?? 'שחקן',
        chore?.title ?? 'משימה',
        chore?.coin_value ?? 0,
        appUrl
      ),
    }),
  })

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

function buildPlayerEmail(playerName: string, choreTitle: string, coinValue: number, appUrl: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="color:#1e1b4b;">🎉 הגשתך אושרה!</h2>
  <p>שלום <strong>${playerName}</strong>,</p>
  <p>המשימה ״<strong>${choreTitle}</strong>״ אושרה על ידי המנהל.</p>
  <p>זוכו לחשבונך <strong>${coinValue} מטבעות</strong>!</p>
  <a href="${appUrl}"
     style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px;font-weight:bold;">
    לצפייה ביתרתך ←
  </a>
</body>
</html>`
}
```

- [ ] **Step 3: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add supabase/functions/notify-player-approval/index.ts
git commit -m "feat: add notify-player-approval edge function"
```

---

### Task 5: Deploy Edge Functions

**Files:**
- No files changed

- [ ] **Step 1: Deploy notify-admin-completion**

```bash
cd D:/Claude_Projects/family-chores
supabase functions deploy notify-admin-completion --no-verify-jwt
```
The `--no-verify-jwt` flag is required because the caller is a database webhook, not an authenticated user.
Expected: `Deployed Function notify-admin-completion on project <ref>`

- [ ] **Step 2: Deploy notify-player-approval**

```bash
supabase functions deploy notify-player-approval --no-verify-jwt
```
Expected: `Deployed Function notify-player-approval on project <ref>`

- [ ] **Step 3: Note your project reference ID**

Go to Supabase Dashboard → **Project Settings** → **General** → copy the **Reference ID** (looks like `abcdefghijklmnop`).

Your deployed function URLs are:
```
https://<ref>.supabase.co/functions/v1/notify-admin-completion
https://<ref>.supabase.co/functions/v1/notify-player-approval
```
Keep these handy for Task 6.

---

### Task 6: Fix double-approval error message in CompletionsPage.tsx

**Files:**
- Modify: `src/pages/admin/completions/CompletionsPage.tsx`
- Modify: `src/pages/admin/completions/__tests__/CompletionsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Open `src/pages/admin/completions/__tests__/CompletionsPage.test.tsx` and add this test inside the existing `describe('CompletionsPage', ...)` block, after the last existing `it(...)`:

```typescript
it('shows specific error and refetches when completion is already approved by another admin', async () => {
  mockUsePendingCompletions.mockReturnValue({ completions: [fakeCompletion], loading: false, error: null, refetch: mockRefetch })
  mockRpc.mockResolvedValue({ error: { message: 'Completion is not pending' } })
  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'אשר' }))
  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent('הגשה זו כבר אושרה על ידי מנהל אחר')
    expect(mockRefetch).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd D:/Claude_Projects/family-chores
npx vitest run src/pages/admin/completions/__tests__/CompletionsPage.test.tsx
```
Expected: the new test FAILS with the generic message `שגיאה באישור ההגשה` instead of the specific one. All other tests pass.

- [ ] **Step 3: Update the approve function in CompletionsPage.tsx**

Find the `approve` function in `src/pages/admin/completions/CompletionsPage.tsx` and replace it with:

```typescript
async function approve(completion: CompletionWithDetails) {
  setActionError(null)
  const { error } = await supabase.rpc('approve_completion', { completion_id: completion.id })
  if (error) {
    if (error.message.includes('not pending')) {
      setActionError('הגשה זו כבר אושרה על ידי מנהל אחר')
      refetch()
    } else {
      setActionError('שגיאה באישור ההגשה')
    }
    return
  }
  if (completion.photo_url) await deletePhoto(completion.photo_url)
  refetch()
}
```

- [ ] **Step 4: Run all CompletionsPage tests to verify they all pass**

```bash
npx vitest run src/pages/admin/completions/__tests__/CompletionsPage.test.tsx
```
Expected: all tests PASS including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/completions/CompletionsPage.tsx src/pages/admin/completions/__tests__/CompletionsPage.test.tsx
git commit -m "fix: show specific error when completion already approved by another admin"
```

---

### Task 7: Configure webhooks in Supabase Dashboard

**Files:**
- No files changed (configured in Supabase Dashboard)

- [ ] **Step 1: Create Webhook 1 — admin notification on submission**

Go to Supabase Dashboard → **Database** → **Webhooks** → **Create a new webhook**.

| Field | Value |
|-------|-------|
| Webhook name | `notify-admin-completion` |
| Table | `chore_completions` |
| Events | `INSERT` only |
| Method | `POST` |
| URL | `https://<ref>.supabase.co/functions/v1/notify-admin-completion` |
| HTTP Header 1 | `Content-Type: application/json` |
| HTTP Header 2 | `x-webhook-secret: 3d59e8d9e35c91ad94352a3d78fa361bc3addcf3116961762e48c9f518de7614` |

Click **Confirm**.

- [ ] **Step 2: Create Webhook 2 — player notification on approval**

Create another webhook:

| Field | Value |
|-------|-------|
| Webhook name | `notify-player-approval` |
| Table | `chore_completions` |
| Events | `UPDATE` only |
| Method | `POST` |
| URL | `https://<ref>.supabase.co/functions/v1/notify-player-approval` |
| HTTP Header 1 | `Content-Type: application/json` |
| HTTP Header 2 | `x-webhook-secret: 3d59e8d9e35c91ad94352a3d78fa361bc3addcf3116961762e48c9f518de7614` |

Click **Confirm**.

---

### Task 8: End-to-end smoke test

**Files:**
- No files changed

- [ ] **Step 1: Test admin notification**

Log in as a player. Navigate to your assigned chores and submit a completion. Within 30 seconds, check the admin's email inbox — you should receive the Hebrew notification email with the chore title and coin value.

- [ ] **Step 2: Test player notification**

Log in as admin. Approve the completion from Step 1. Within 30 seconds, check the player's email inbox (only if the player has an auth email) — you should receive the approval email with coin count.

- [ ] **Step 3: Verify players without email are unaffected**

If a player account has no auth email: submit and approve a completion for that player. No email should be sent, but the in-app notification (bell icon) should still appear as normal.

- [ ] **Step 4: Test double-approval UI fix**

Open the completions page in two browser tabs (both logged in as admin). In Tab A, approve a completion. In Tab B (which still shows the same completion), click Approve. Tab B should show "הגשה זו כבר אושרה על ידי מנהל אחר" and the completion should disappear from the list.
