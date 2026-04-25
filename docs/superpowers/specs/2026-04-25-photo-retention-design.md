# Photo Retention Policy — Design Spec
**Date:** 2026-04-25
**Status:** Approved for implementation planning

---

## Overview

Completion photos are ephemeral proof — they have no long-term value once a chore is reviewed. This spec covers three coordinated pieces that together enforce the retention policy:

1. **DB RPCs** null `photo_url` atomically on approve/reject (server-side, source of truth)
2. **Client** deletes from Storage best-effort after RPC succeeds
3. **Edge Function** (`cleanup-photos`) runs weekly to catch orphans and auto-reject stale pending completions

---

## 1. Goals

- Photos deleted from Supabase Storage as soon as a completion is reviewed
- `photo_url` field nulled in DB atomically with the status change — DB is always the source of truth
- Pending completions older than 30 days auto-rejected and their photos deleted
- No photo paths written to logs anywhere
- System is resilient: client-side failures do not permanently orphan photos
- Storage paths validated before deletion — no cross-bucket or path-traversal risk
- Cleanup runs recorded in `system_logs` table for admin auditability
- DB indexes added to keep cleanup queries fast as table grows
- Consecutive full-batch runs logged as warnings for capacity monitoring

---

## 2. Architecture

```
┌─────────────────────────────────────────────────┐
│ 1. DB RPCs (server-side, atomic)                │
│    approve_completion → photo_url = null        │
│    reject_completion  → photo_url = null        │
└────────────────────┬────────────────────────────┘
                     │ RPC succeeds, client holds
                     │ path in memory
┌────────────────────▼────────────────────────────┐
│ 2. Client (best-effort)                         │
│    supabase.storage.remove([path])              │
│    CompletionsPage.tsx (admin approve/reject)   │
│    CompletionPage.tsx  (trust 4-5 self-verify)  │
│    Failure silently ignored — cron safety net   │
└────────────────────┬────────────────────────────┘
                     │ orphans from client failure
┌────────────────────▼────────────────────────────┐
│ 3. Edge Function: cleanup-photos (weekly cron)  │
│    Job 1: delete orphaned photos                │
│      (approved/rejected, photo_url IS NOT NULL) │
│    Job 2: auto-reject pending > 30 days         │
│      (delete photo + reject + reset assignment) │
└─────────────────────────────────────────────────┘
```

---

## 3. DB Changes — Migration `029_photo_retention.sql`

### 3.1 RPC Updates

Both `approve_completion` and `reject_completion` are updated to null `photo_url` atomically with the status change.

**`approve_completion`** — add `photo_url = null` to the `UPDATE chore_completions` statement:
```sql
UPDATE chore_completions
  SET status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      photo_url = null
  WHERE id = completion_id;
```

**`reject_completion`** — same addition:
```sql
UPDATE chore_completions
  SET status = 'rejected',
      rejection_reason = reason,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      photo_url = null
  WHERE id = completion_id;
```

No schema changes required — `photo_url` is already nullable.

### 3.2 DB Indexes

Added in the same migration to keep Edge Function queries fast:

```sql
-- Job 1: find approved/rejected completions that still have a photo
CREATE INDEX idx_completions_orphaned_photos
  ON chore_completions (status)
  WHERE photo_url IS NOT NULL;

-- Job 2: find stale pending completions
CREATE INDEX idx_completions_stale_pending
  ON chore_completions (completed_at)
  WHERE status = 'pending';
```

Partial indexes — only index the rows that matter for each query. No overhead on the common case (photo_url already null).

### 3.3 `system_logs` Table

New table for recording cleanup run summaries:

```sql
CREATE TABLE system_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name  TEXT NOT NULL,
  run_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result         JSONB NOT NULL,
  had_errors     BOOLEAN NOT NULL DEFAULT FALSE
);
```

`result` stores counts only — e.g. `{"orphans_cleaned": 3, "stale_rejected": 1, "errors": 0}`. No photo paths, no user data.

**RLS:** No SELECT policy for players. Admins can read via a dedicated policy. No INSERT/UPDATE/DELETE policies for any client role — Edge Function writes via `service_role` only.

### 3.4 Cron Schedule

Added via pg_cron + pg_net in the same migration. Triggers the Edge Function every Sunday at 3:00 AM:

```sql
SELECT cron.schedule(
  'cleanup-photos-weekly',
  '0 3 * * 0',
  $$
    SELECT net.http_post(
      url     := current_setting('app.cleanup_photos_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.cron_secret'),
        'Content-Type',  'application/json'
      ),
      body    := '{}'::jsonb
    )
  $$
);
```

`app.cleanup_photos_url` and `app.cron_secret` are set as Postgres configuration parameters (via `ALTER DATABASE ... SET`) rather than hardcoded in SQL — keeping secrets out of migration source.

**Security:** pg_net is granted execute only to the `postgres` role. The cron job runs as `postgres`. No anon or authenticated role can call `net.http_post` directly.

---

## 4. Client-Side Fixes

### 4.1 `CompletionsPage.tsx` (admin approve/reject)

No behavioral change. `deletePhoto` is already called after `approve()` and `confirmReject()`. The path is read from the in-memory `completion` object before the RPC nulls it in the DB. This remains correct.

### 4.2 `CompletionPage.tsx` (trust 4–5 self-verification)

Currently calls `approve_completion` RPC but never deletes the photo. Fix: call `supabase.storage.remove()` immediately after the RPC succeeds, using `filePath` already in scope:

```typescript
if ((profile.trust_level ?? 1) >= 4) {
  const { error: rpcError } = await supabase.rpc('approve_completion', {
    completion_id: completion.id,
  })
  if (rpcError) { setError('שגיאה בקבלת המטבעות'); return }
  // Best-effort — DB already has photo_url = null via RPC
  await supabase.storage.from('completion-photos').remove([filePath])
}
```

Failure of `remove()` is intentionally not checked — the weekly cron covers orphans.

---

## 5. Edge Function — `cleanup-photos`

**File:** `supabase/functions/cleanup-photos/index.ts`

### 5.1 Authentication

Every request must carry the `CRON_SECRET` in the `Authorization` header. The function rejects all other callers with `401`:

```typescript
const cronSecret = Deno.env.get('CRON_SECRET')
if (!cronSecret) throw new Error('CRON_SECRET not configured')

const authHeader = req.headers.get('Authorization')
if (authHeader !== `Bearer ${cronSecret}`) {
  return new Response('Unauthorized', { status: 401 })
}
```

`CRON_SECRET` is set via `supabase secrets set` — never in source code or committed files.

### 5.2 Supabase Client

Uses the auto-injected `SUPABASE_SERVICE_ROLE_KEY` — never manually provided, never logged:

```typescript
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
```

### 5.3 Storage Path Validation

Before any `storage.remove()` call, the path is validated against the expected format:

```typescript
const SAFE_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i

function isValidPhotoPath(path: string): boolean {
  return SAFE_PATH_RE.test(path) && !path.includes('..')
}
```

Expected format: `{user-uuid}/{file-uuid}.webp` — matches exactly what `CompletionPage.tsx` constructs. Any path that fails validation is skipped and logged (ID only, not the path itself) — never passed to `storage.remove()`. This prevents accidental or malicious deletion of files outside the expected naming scheme.

### 5.4 Job 1 — Orphaned Photos

Targets completions that were approved or rejected but whose `photo_url` was not nulled (client deletion failed):

```
SELECT id, photo_url FROM chore_completions
WHERE status IN ('approved', 'rejected')
  AND photo_url IS NOT NULL
LIMIT 50
```

For each record:
1. Validate `photo_url` with `isValidPhotoPath()` — skip if invalid
2. `storage.remove([photo_url])` — delete from Storage
3. `UPDATE chore_completions SET photo_url = null WHERE id = <id>` — null in DB

If Storage deletion fails: log completion ID (not path), skip DB update, continue. The record will be retried next weekly run.

If DB update fails after Storage deletion: log completion ID, continue. Photo is gone but `photo_url` still set — DB update will be retried harmlessly next run.

### 5.5 Job 2 — Stale Pending Completions

Targets completions unreviewed for more than 30 days:

```
SELECT id, photo_url, chore_assignment_id
FROM chore_completions
WHERE status = 'pending'
  AND completed_at < now() - interval '30 days'
LIMIT 50
```

For each record:
1. If `photo_url` is set: `storage.remove([photo_url])` — best-effort, log ID on failure
2. `UPDATE chore_completions SET status='rejected', rejection_reason='פג תוקף — לא אושר תוך 30 יום', photo_url=null, reviewed_at=now() WHERE id = <id>`
3. `UPDATE chore_assignments SET status='pending' WHERE id = <chore_assignment_id>` — resets assignment so player can resubmit

### 5.6 Batching and Capacity Monitoring

Both jobs use `LIMIT 50`. If a run finds exactly 50 records, it processes them and returns — remaining records are handled the following week. This keeps execution well within the 150-second Edge Function timeout.

If either job returns exactly 50 records (the batch limit), the function logs a structured warning:

```json
{ "warning": "BATCH_LIMIT_REACHED", "job": "orphans", "count": 50 }
```

This signals that cleanup volume may be outpacing the weekly cadence — an operator should investigate whether the batch size or schedule needs adjustment. The warning appears in Supabase Edge Function logs, visible in the dashboard.

### 5.7 Response and Audit Log

Response body:
```json
{ "orphans_cleaned": 3, "stale_rejected": 1, "errors": 0 }
```

After completing both jobs, the function inserts one row into `system_logs`:

```typescript
await supabase.from('system_logs').insert({
  function_name: 'cleanup-photos',
  result: { orphans_cleaned, stale_rejected, errors },
  had_errors: errors > 0,
})
```

Counts only — no paths, no user data, no photo URLs in the log row.

### 5.8 Security Hardening Summary

| Concern | Mitigation |
|---|---|
| Unauthorized invocation | `CRON_SECRET` bearer check — 401 on mismatch |
| Service role key exposure | Auto-injected by Supabase runtime, never in source |
| Photo path leakage | Paths never logged; only IDs and counts emitted |
| Cross-bucket / path traversal deletion | `isValidPhotoPath()` validates UUID/webp format before any `storage.remove()` call |
| SQL injection | Supabase JS client uses parameterized queries throughout |
| Timeout / runaway | Batch size capped at 50; idempotent on re-run |
| Missing env var | Function throws `500` on startup if `CRON_SECRET` not set |
| Audit trail | Every run recorded in `system_logs` — counts only, no sensitive data |
| Capacity blind spots | Batch-limit warnings emitted to Edge Function logs when either job hits 50 |

---

## 6. Error Handling

| Scenario | Behaviour |
|---|---|
| Storage deletion fails (Job 1/2) | Log completion ID, skip DB update, retry next week |
| DB update fails after Storage deletion | Log completion ID, continue — photo gone, cron retries DB update next week |
| RPC (`approve`/`reject`) fails client-side | Client never reaches `deletePhoto` — orphan caught by Job 1 |
| Edge Function throws | Supabase logs error; next weekly run retries all unprocessed records |
| `CRON_SECRET` not set | Function throws `500` at startup — misconfiguration is loud |

---

## 7. Testing

### Migration `029`
- `approve_completion` returns completion with `photo_url = null`
- `reject_completion` returns completion with `photo_url = null`
- Existing coin award and assignment status behaviour unchanged

### `CompletionPage.tsx`
- Trust 4–5 path: verify `supabase.storage.remove()` called with correct `filePath` after RPC succeeds
- Trust 4–5 path: verify `remove()` failure does not block navigation

### Edge Function `cleanup-photos`
- Request with missing `Authorization` header → 401
- Request with wrong secret → 401
- Job 1: mock completions with `status='approved'` and `photo_url` set → storage deleted, `photo_url` nulled
- Job 2: mock completions with `status='pending'` and `completed_at` >30 days ago → rejected, assignment reset
- Storage failure in Job 1 → DB not updated, function continues, counts reflect partial success
- Response body contains correct counts
- `isValidPhotoPath()`: valid UUID/webp path → true; path with `..` → false; wrong extension → false; single segment → false
- Malformed `photo_url` in DB → skipped (not passed to `storage.remove()`), logged by ID
- Either job hits exactly 50 records → warning logged with `BATCH_LIMIT_REACHED`
- Successful run → row inserted into `system_logs` with correct counts and `had_errors = false`
- Run with storage errors → `system_logs` row has `had_errors = true`, `errors` count > 0

---

## 8. Out of Scope

- Push/email notification to player when stale completion is auto-rejected (future version)
- Admin dashboard storage usage monitoring (separate spec)
- Database row pruning for old transactions, assignments, notifications (separate spec)
