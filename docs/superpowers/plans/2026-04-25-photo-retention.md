# Photo Retention Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the photo retention policy — null `photo_url` atomically in DB RPCs on review, delete photos client-side best-effort, fix the missing self-verification deletion, and deploy a weekly Edge Function that cleans up orphans and auto-rejects stale pending completions.

**Architecture:** Three-layer hybrid. DB RPCs own the source of truth (null `photo_url` atomically with status change). Client code attempts Storage deletion best-effort using the in-memory path before the RPC runs. A weekly Edge Function catches anything the client missed and auto-rejects pending completions older than 30 days.

**Tech Stack:** PostgreSQL (Supabase), React + TypeScript, Deno (Supabase Edge Functions), Vitest, Deno test runner

---

## File Map

| File | Change |
|------|--------|
| `supabase/migrations/029_photo_retention.sql` | Create — updated RPCs, indexes, system_logs table + RLS, cron schedule |
| `src/pages/player/chores/CompletionPage.tsx` | Modify — add `storage.remove()` after self-verification RPC |
| `src/pages/player/chores/__tests__/CompletionPage.test.tsx` | Modify — add test for photo deletion in trust 4-5 path |
| `supabase/functions/cleanup-photos/index.ts` | Create — Edge Function with auth, path validation, Job 1, Job 2, system_logs write |
| `supabase/functions/cleanup-photos/index.test.ts` | Create — Deno tests for `isValidPhotoPath` and handler auth rejection |

---

## Task 1: DB migration — RPCs, indexes, system_logs, cron

**Files:**
- Create: `supabase/migrations/029_photo_retention.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/029_photo_retention.sql`:

```sql
-- ──────────────────────────────────────────────────────��──────────────────────
-- 1. system_logs table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name  TEXT        NOT NULL,
  run_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result         JSONB       NOT NULL,
  had_errors     BOOLEAN     NOT NULL DEFAULT FALSE
);

ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

-- Admins can read all logs for their family (system_logs has no family_id —
-- it is global; only admins should ever see it)
CREATE POLICY "system_logs: admins can read"
  ON system_logs FOR SELECT
  USING (is_admin());

-- No client INSERT/UPDATE/DELETE — Edge Functions write via service_role only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Partial indexes for cleanup-photos Edge Function queries
-- ─────────────────────────────────────────────────────────────────────────────

-- Job 1: find approved/rejected completions that still hold a photo path
CREATE INDEX IF NOT EXISTS idx_completions_orphaned_photos
  ON chore_completions (status)
  WHERE photo_url IS NOT NULL;

-- Job 2: find stale pending completions by age
CREATE INDEX IF NOT EXISTS idx_completions_stale_pending
  ON chore_completions (completed_at)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. approve_completion — add photo_url = null
--    Full function copy from migration 025 with one added line.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_completion(completion_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completion    chore_completions%ROWTYPE;
  v_assignment    chore_assignments%ROWTYPE;
  v_chore         chores%ROWTYPE;
  v_caller_family uuid;
  v_caller_trust  integer;
BEGIN
  SELECT * INTO v_completion FROM chore_completions WHERE id = completion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completion not found';
  END IF;
  IF v_completion.status <> 'pending' THEN
    RAISE EXCEPTION 'Completion is not pending';
  END IF;

  SELECT * INTO v_assignment FROM chore_assignments WHERE id = v_completion.chore_assignment_id;
  SELECT * INTO v_chore      FROM chores             WHERE id = v_assignment.chore_id;

  IF NOT is_admin() THEN
    SELECT family_id, trust_level INTO v_caller_family, v_caller_trust
    FROM profiles WHERE id = auth.uid();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not authorized: caller has no profile';
    END IF;

    IF COALESCE(v_caller_trust, 1) < 4 THEN
      RAISE EXCEPTION 'Not authorized: trust level too low to approve completions';
    END IF;

    IF v_caller_family IS NULL OR v_caller_family <> v_chore.family_id THEN
      RAISE EXCEPTION 'Not authorized: approver is not in the same family as this chore';
    END IF;

    IF v_caller_trust = 4 AND v_completion.completed_by <> auth.uid() THEN
      RAISE EXCEPTION 'Not authorized: trust level 4 may only approve own completions';
    END IF;
  END IF;

  UPDATE chore_completions
    SET status      = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        photo_url   = null            -- nulled atomically; DB is source of truth
    WHERE id = completion_id;

  UPDATE chore_assignments SET status = 'completed' WHERE id = v_assignment.id;

  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
    VALUES (v_completion.completed_by, v_chore.family_id, v_chore.coin_value, 'chore_completed', completion_id);

  UPDATE profiles
    SET coin_balance = coin_balance + v_chore.coin_value
    WHERE id = v_completion.completed_by;

  PERFORM recalculate_trust_level(v_completion.completed_by);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. reject_completion — add photo_url = null
--    Full function copy from migration 025 with one added line.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_completion(completion_id UUID, reason TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completion chore_completions%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can reject completions';
  END IF;

  SELECT * INTO v_completion FROM chore_completions WHERE id = completion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completion not found';
  END IF;

  UPDATE chore_completions
    SET status           = 'rejected',
        rejection_reason = reason,
        reviewed_by      = auth.uid(),
        reviewed_at      = now(),
        photo_url        = null       -- nulled atomically; DB is source of truth
    WHERE id = completion_id;

  UPDATE chore_assignments
    SET status = 'pending'
    WHERE id = v_completion.chore_assignment_id;

  PERFORM recalculate_trust_level(v_completion.completed_by);
END;
$$;
```

- [ ] **Step 2: Apply the migration**

```bash
supabase db push
```

Expected output: `Applying migration 029_photo_retention.sql... done`

- [ ] **Step 3: Verify in Supabase dashboard**

- Table Editor → confirm `system_logs` table exists with columns: `id`, `function_name`, `run_at`, `result`, `had_errors`
- SQL Editor → run: `SELECT indexname FROM pg_indexes WHERE tablename = 'chore_completions';`
  - Confirm `idx_completions_orphaned_photos` and `idx_completions_stale_pending` are listed

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/029_photo_retention.sql
git commit -m "feat(db): null photo_url in approve/reject RPCs, add system_logs table and cleanup indexes"
```

---

## Task 2: Client fix — self-verification photo deletion

**Files:**
- Modify: `src/pages/player/chores/__tests__/CompletionPage.test.tsx`
- Modify: `src/pages/player/chores/CompletionPage.tsx`

- [ ] **Step 1: Write the failing test**

Open `src/pages/player/chores/__tests__/CompletionPage.test.tsx` and add this test inside the existing `describe('CompletionPage', ...)` block, after the last existing test:

```typescript
it('calls storage.remove() with the uploaded file path after trust 4+ approve_completion succeeds', async () => {
  mockTrustLevel = 4
  const storageMock = makeStorageMock({ error: null })
  storageMock.remove = vi.fn().mockResolvedValue({ error: null })
  mockStorageFrom.mockReturnValue(storageMock)
  mockFrom.mockReturnValue(makeInsertChain({ data: { id: 'comp1' }, error: null }))
  mockRpc.mockResolvedValue({ error: null })
  renderPage()

  const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
  await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
  await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/player'))
  expect(storageMock.remove).toHaveBeenCalledWith(
    expect.arrayContaining([expect.stringMatching(/^p1\/.+\.webp$/)])
  )
})

it('navigates to /player even when storage.remove() fails for trust 4+ players', async () => {
  mockTrustLevel = 4
  const storageMock = makeStorageMock({ error: null })
  storageMock.remove = vi.fn().mockResolvedValue({ error: { message: 'storage error' } })
  mockStorageFrom.mockReturnValue(storageMock)
  mockFrom.mockReturnValue(makeInsertChain({ data: { id: 'comp1' }, error: null }))
  mockRpc.mockResolvedValue({ error: null })
  renderPage()

  const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
  await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
  await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/player'))
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
npm run test:run -- src/pages/player/chores/__tests__/CompletionPage.test.tsx
```

Expected: the two new tests FAIL (`remove` not called / test infrastructure error). All existing tests still PASS.

- [ ] **Step 3: Add photo deletion to CompletionPage.tsx**

Open `src/pages/player/chores/CompletionPage.tsx`. Find this block (lines 65–70):

```typescript
      if ((profile.trust_level ?? 1) >= 4) {
        const { error: rpcError } = await supabase.rpc('approve_completion', {
          completion_id: completion.id,
        })
        if (rpcError) { setError('שגיאה בקבלת המטבעות'); return }
      }
```

Replace it with:

```typescript
      if ((profile.trust_level ?? 1) >= 4) {
        const { error: rpcError } = await supabase.rpc('approve_completion', {
          completion_id: completion.id,
        })
        if (rpcError) { setError('שגיאה בקבלת המטבעות'); return }
        // Best-effort: DB already has photo_url = null via RPC; cron covers any orphan
        await supabase.storage.from('completion-photos').remove([filePath])
      }
```

- [ ] **Step 4: Run all CompletionPage tests to verify they pass**

```bash
npm run test:run -- src/pages/player/chores/__tests__/CompletionPage.test.tsx
```

Expected: all tests PASS including the two new ones.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm run test:run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/player/chores/CompletionPage.tsx \
        src/pages/player/chores/__tests__/CompletionPage.test.tsx
git commit -m "fix(player): delete photo from storage after self-verification approve_completion"
```

---

## Task 3: Edge Function — cleanup-photos

**Files:**
- Create: `supabase/functions/cleanup-photos/index.ts`

- [ ] **Step 1: Create the Edge Function**

Create `supabase/functions/cleanup-photos/index.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Exported for unit testing
export const SAFE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i

export function isValidPhotoPath(path: unknown): boolean {
  return (
    typeof path === 'string' &&
    !path.includes('..') &&
    SAFE_PATH_RE.test(path)
  )
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error(JSON.stringify({ error: 'CRON_SECRET_NOT_CONFIGURED' }))
    return new Response('Internal Server Error', { status: 500 })
  }

  const authHeader = req.headers.get('Authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // ── Supabase client (service_role — auto-injected by Supabase runtime) ────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  let orphansCleaned = 0
  let staleRejected = 0
  let errors = 0

  // ── Job 1: Orphaned photos ────────────────────────────────────────────────
  // Targets completions that are approved/rejected but photo_url was not nulled
  // (client-side deletion failed after the RPC succeeded).
  const { data: orphans, error: orphanQueryError } = await supabase
    .from('chore_completions')
    .select('id, photo_url')
    .in('status', ['approved', 'rejected'])
    .not('photo_url', 'is', null)
    .limit(50)

  if (orphanQueryError) {
    console.error(JSON.stringify({ error: 'ORPHAN_QUERY_FAILED', message: orphanQueryError.message }))
    errors++
  } else if (orphans) {
    if (orphans.length === 50) {
      console.warn(JSON.stringify({ warning: 'BATCH_LIMIT_REACHED', job: 'orphans', count: 50 }))
    }

    for (const completion of orphans) {
      if (!isValidPhotoPath(completion.photo_url)) {
        console.error(JSON.stringify({ error: 'INVALID_PATH', id: completion.id }))
        errors++
        continue
      }

      const { error: storageError } = await supabase.storage
        .from('completion-photos')
        .remove([completion.photo_url as string])

      if (storageError) {
        console.error(JSON.stringify({ error: 'STORAGE_DELETE_FAILED', id: completion.id }))
        errors++
        continue
      }

      const { error: dbError } = await supabase
        .from('chore_completions')
        .update({ photo_url: null })
        .eq('id', completion.id)

      if (dbError) {
        console.error(JSON.stringify({ error: 'DB_NULL_FAILED', id: completion.id }))
        errors++
        continue
      }

      orphansCleaned++
    }
  }

  // ── Job 2: Stale pending completions ──────────────────────────────────────
  // Targets completions unreviewed for more than 30 days. Auto-rejects them
  // and resets the assignment to pending so the player can resubmit.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: stale, error: staleQueryError } = await supabase
    .from('chore_completions')
    .select('id, photo_url, chore_assignment_id')
    .eq('status', 'pending')
    .lt('completed_at', thirtyDaysAgo)
    .limit(50)

  if (staleQueryError) {
    console.error(JSON.stringify({ error: 'STALE_QUERY_FAILED', message: staleQueryError.message }))
    errors++
  } else if (stale) {
    if (stale.length === 50) {
      console.warn(JSON.stringify({ warning: 'BATCH_LIMIT_REACHED', job: 'stale', count: 50 }))
    }

    for (const completion of stale) {
      // Delete photo best-effort; rejection proceeds regardless
      if (isValidPhotoPath(completion.photo_url)) {
        const { error: storageError } = await supabase.storage
          .from('completion-photos')
          .remove([completion.photo_url as string])
        if (storageError) {
          console.error(JSON.stringify({ error: 'STALE_STORAGE_DELETE_FAILED', id: completion.id }))
          errors++
        }
      } else if (completion.photo_url !== null) {
        console.error(JSON.stringify({ error: 'STALE_INVALID_PATH', id: completion.id }))
        errors++
      }

      const { error: rejectError } = await supabase
        .from('chore_completions')
        .update({
          status: 'rejected',
          rejection_reason: 'פג תוקף — לא אושר תוך 30 יום',
          photo_url: null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', completion.id)

      if (rejectError) {
        console.error(JSON.stringify({ error: 'STALE_REJECT_FAILED', id: completion.id }))
        errors++
        continue
      }

      // Reset assignment so player can resubmit
      const { error: assignError } = await supabase
        .from('chore_assignments')
        .update({ status: 'pending' })
        .eq('id', completion.chore_assignment_id)

      if (assignError) {
        console.error(JSON.stringify({ error: 'ASSIGNMENT_RESET_FAILED', id: completion.id }))
        errors++
        continue
      }

      staleRejected++
    }
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  const result = { orphans_cleaned: orphansCleaned, stale_rejected: staleRejected, errors }
  await supabase.from('system_logs').insert({
    function_name: 'cleanup-photos',
    result,
    had_errors: errors > 0,
  })

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/cleanup-photos/index.ts
git commit -m "feat(edge): add cleanup-photos Edge Function — orphan cleanup and stale rejection"
```

---

## Task 4: Edge Function tests

**Files:**
- Create: `supabase/functions/cleanup-photos/index.test.ts`

> **Prerequisite:** Deno must be installed. Check: `deno --version`. If missing, install from https://deno.land (or `winget install DenoLand.Deno` on Windows).

- [ ] **Step 1: Write the test file**

Create `supabase/functions/cleanup-photos/index.test.ts`:

```typescript
import { assertEquals, assertFalse } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { isValidPhotoPath, SAFE_PATH_RE } from './index.ts'

const VALID_PATH =
  '123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-12d3-a456-426614174001.webp'

// ── isValidPhotoPath ──────────────────────────────────────────────────────────

Deno.test('isValidPhotoPath: valid UUID/webp path returns true', () => {
  assertEquals(isValidPhotoPath(VALID_PATH), true)
})

Deno.test('isValidPhotoPath: path with .. traversal returns false', () => {
  assertFalse(isValidPhotoPath('../other-bucket/secret.webp'))
})

Deno.test('isValidPhotoPath: wrong extension returns false', () => {
  assertFalse(
    isValidPhotoPath(
      '123e4567-e89b-12d3-a456-426614174000/123e4567-e89b-12d3-a456-426614174001.jpg'
    )
  )
})

Deno.test('isValidPhotoPath: single segment (no directory) returns false', () => {
  assertFalse(isValidPhotoPath('secret.webp'))
})

Deno.test('isValidPhotoPath: empty string returns false', () => {
  assertFalse(isValidPhotoPath(''))
})

Deno.test('isValidPhotoPath: null returns false', () => {
  assertFalse(isValidPhotoPath(null))
})

Deno.test('isValidPhotoPath: non-UUID prefix returns false', () => {
  assertFalse(isValidPhotoPath('admin/123e4567-e89b-12d3-a456-426614174001.webp'))
})

Deno.test('isValidPhotoPath: path with embedded .. returns false', () => {
  assertFalse(
    isValidPhotoPath(
      '123e4567-e89b-12d3-a456-426614174000/../../etc/passwd'
    )
  )
})

// ── Handler auth rejection ────────────────────────────────────────────────────
// These tests exercise the handler's 401 path without needing a live Supabase
// instance by calling fetch() on a locally-served instance.
// Skip if CRON_SECRET env var is not set (CI without secrets).

const CRON_SECRET = Deno.env.get('CRON_SECRET')

Deno.test({
  name: 'handler: missing Authorization header returns 401',
  ignore: !CRON_SECRET,
  fn: async () => {
    const { handler } = await import('./index.ts')
    const req = new Request('http://localhost/', { method: 'POST' })
    const res = await handler(req)
    assertEquals(res.status, 401)
  },
})

Deno.test({
  name: 'handler: wrong secret returns 401',
  ignore: !CRON_SECRET,
  fn: async () => {
    const { handler } = await import('./index.ts')
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
    })
    const res = await handler(req)
    assertEquals(res.status, 401)
  },
})
```

> **Note on handler export tests:** The handler tests above require exporting the handler function from `index.ts`. See Step 2 — this is a minor refactor of the Edge Function to make the handler testable.

- [ ] **Step 2: Export the handler from index.ts**

Open `supabase/functions/cleanup-photos/index.ts`. Replace the `Deno.serve(async (req: Request)` line with:

```typescript
export async function handler(req: Request): Promise<Response> {
```

And add at the bottom of the file, after the closing `}` of the handler function:

```typescript
Deno.serve(handler)
```

- [ ] **Step 3: Run the tests to verify they pass**

```bash
deno test supabase/functions/cleanup-photos/index.test.ts --allow-env --allow-net
```

Expected:
```
running 10 tests from ./index.test.ts
isValidPhotoPath: valid UUID/webp path returns true ... ok
isValidPhotoPath: path with .. traversal returns false ... ok
isValidPhotoPath: wrong extension returns false ... ok
isValidPhotoPath: single segment (no directory) returns false ... ok
isValidPhotoPath: empty string returns false ... ok
isValidPhotoPath: null returns false ... ok
isValidPhotoPath: non-UUID prefix returns false ... ok
isValidPhotoPath: path with embedded .. returns false ... ok
handler: missing Authorization header returns 401 ... skipped (no CRON_SECRET in env)
handler: wrong secret returns 401 ... skipped (no CRON_SECRET in env)
ok | 8 passed | 2 skipped
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/cleanup-photos/index.test.ts \
        supabase/functions/cleanup-photos/index.ts
git commit -m "test(edge): add Deno tests for isValidPhotoPath and handler auth rejection"
```

---

## Task 5: Deploy Edge Function and configure cron

- [ ] **Step 1: Ensure project is linked**

```bash
supabase status
```

If output shows `supabase local development setup is not running`, link the project:

```bash
supabase link --project-ref <your-project-ref>
```

Project ref is visible in your Supabase dashboard URL: `https://supabase.com/dashboard/project/<ref>`

- [ ] **Step 2: Deploy the Edge Function**

```bash
supabase functions deploy cleanup-photos
```

Expected output:
```
Deploying function cleanup-photos ... done
```

- [ ] **Step 3: Smoke-test authentication**

Replace `<project-ref>` and run:

```bash
# Should return 401
curl -s -o /dev/null -w "%{http_code}" \
  https://<project-ref>.supabase.co/functions/v1/cleanup-photos

# Should return 401
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer wrong-secret" \
  https://<project-ref>.supabase.co/functions/v1/cleanup-photos
```

Both should print `401`.

- [ ] **Step 4: Smoke-test with correct secret**

```bash
curl -s \
  -H "Authorization: Bearer lX4i9k5Jwi9P3rmDQI4dnaCZ1sFYRmDAuD1oWl9u5Kg=" \
  https://<project-ref>.supabase.co/functions/v1/cleanup-photos
```

Expected (first run on a clean DB):
```json
{"orphans_cleaned":0,"stale_rejected":0,"errors":0}
```

Verify a row was written to `system_logs`:
```sql
SELECT * FROM system_logs WHERE function_name = 'cleanup-photos' ORDER BY run_at DESC LIMIT 1;
```

- [ ] **Step 5: Configure the weekly cron**

In Supabase Dashboard → SQL Editor, run (substitute your actual values):

```sql
-- Requires pg_net extension. Enable it first if not already:
-- Dashboard → Database → Extensions → search "pg_net" → Enable

SELECT cron.schedule(
  'cleanup-photos-weekly',
  '0 3 * * 0',   -- every Sunday at 03:00 UTC
  format(
    $cmd$
      SELECT net.http_post(
        url     := %L,
        headers := %L::jsonb,
        body    := '{}'::jsonb
      )
    $cmd$,
    'https://<project-ref>.supabase.co/functions/v1/cleanup-photos',
    '{"Authorization": "Bearer lX4i9k5Jwi9P3rmDQI4dnaCZ1sFYRmDAuD1oWl9u5Kg=", "Content-Type": "application/json"}'
  )
);
```

Verify the job is registered:
```sql
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'cleanup-photos-weekly';
```

Expected: one row with the correct schedule and command.

- [ ] **Step 6: Final commit**

```bash
git add supabase/functions/cleanup-photos/
git commit -m "feat(edge): deploy cleanup-photos and configure weekly cron"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| `approve_completion` nulls `photo_url` atomically | Task 1 |
| `reject_completion` nulls `photo_url` atomically | Task 1 |
| Partial indexes for Edge Function queries | Task 1 |
| `system_logs` table with RLS (admin read, service_role write) | Task 1 |
| Self-verification path deletes photo after RPC | Task 2 |
| `isValidPhotoPath()` UUID/webp regex + `..` guard | Task 3 |
| `CRON_SECRET` bearer check → 401 on mismatch | Task 3 |
| `SUPABASE_SERVICE_ROLE_KEY` auto-injected, never hardcoded | Task 3 |
| Job 1: orphaned photos deleted + `photo_url` nulled | Task 3 |
| Job 2: stale pending auto-rejected + assignment reset | Task 3 |
| Batch limit 50 with `BATCH_LIMIT_REACHED` warning | Task 3 |
| `system_logs` insert after each run | Task 3 |
| No photo paths in logs | Task 3 |
| `isValidPhotoPath` unit tests | Task 4 |
| Handler auth rejection tests | Task 4 |
| Weekly cron via pg_cron + pg_net | Task 5 |
| Smoke test after deploy | Task 5 |
