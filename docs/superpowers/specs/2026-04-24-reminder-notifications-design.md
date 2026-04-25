# Reminder Notifications — Design Spec
**Date:** 2026-04-24
**Status:** Approved for implementation planning

---

## Overview

Deliver in-app reminder notifications 30 minutes before a chore's pinned calendar slot. Only slotted assignments get reminders. Unslotted assignments with `reminder_enabled=true` save the flag but never fire. Email delivery is a future extension requiring no changes to this design.

---

## 1. Slot Time Boundaries

| Slot | Start time | Reminder fires |
|------|-----------|----------------|
| `morning` | 08:00 | 07:30–08:00 |
| `noon` | 12:00 | 11:30–12:00 |
| `afternoon` | 16:00 | 15:30–16:00 |

All times in **Asia/Jerusalem** timezone (handles DST automatically via `AT TIME ZONE 'Asia/Jerusalem'`).

**DST boundary behaviour:** Israel transitions twice yearly. PostgreSQL's `AT TIME ZONE 'Asia/Jerusalem'` uses the IANA tz database and handles clock shifts correctly. Two edge cases per year:
- **Spring-forward (clock skips 1h):** If a reminder window falls in the skipped hour, that run does not fire. Acceptable — once-a-year miss.
- **Fall-back (clock repeats 1h):** A window could appear twice in one day. The `reminder_sent_at IS NULL` guard prevents double-fire. Safe by design.

---

## 2. Architecture

### pg_cron schedule
`send_reminder_notifications()` runs every 30 minutes (`*/30 * * * *`). Fires 48×/day; only 6 runs per day fall inside reminder windows. Lightweight no-op outside windows.

### `send_reminder_notifications()` SQL function
- `SECURITY DEFINER`, `SET search_path = public`
- `REVOKE EXECUTE` from `PUBLIC`, `authenticated`, `anon` — only pg_cron (postgres owner) may call it
- No user input; no injection surface
- Family isolation enforced by `chore_assignments → chores → chores.family_id` JOIN — cross-family reads structurally impossible

**Logic:**
1. Compute current Israel local time: `now() AT TIME ZONE 'Asia/Jerusalem'`
2. Extract `current_time_of_day` and `current_dow` (0=Sun … 6=Sat)
3. For each active slot window, query assignments where:
   - `reminder_enabled = true`
   - `status NOT IN ('completed', 'failed')`
   - `archived = false`
   - `calendar_slot` matches current window
   - `calendar_day` matches today's day-of-week
   - `reminder_sent_at IS NULL`
4. Lock each row with `FOR UPDATE` (prevents double-fire on overlapping pg_cron runs)
5. Insert `notifications` row (type=`reminder`)
6. Set `reminder_sent_at = now()` on assignment

### `toggle_reminder(p_assignment_id uuid)` RPC
- `SECURITY DEFINER`, `SET search_path = public`
- Callable by `authenticated` role only (not `anon`)
- Validates `auth.uid() = chore_assignments.user_id` — raises `'Not authorized'` otherwise
- Toggles `reminder_enabled`
- On **enable**: resets `reminder_sent_at = NULL` so reminder fires again
- On **disable**: leaves `reminder_sent_at` unchanged
- Only touches `reminder_enabled` and `reminder_sent_at` — no other columns

### `reschedule_assignment(p_assignment_id uuid, p_day int, p_slot text)` RPC
- `SECURITY DEFINER`, `SET search_path = public`
- Callable by `authenticated` role only (not `anon`)
- Validates `auth.uid() = chore_assignments.user_id` — raises `'Not authorized'` otherwise
- Updates `calendar_day` and `calendar_slot` to the new values (`NULL` = unpin)
- **Re-arms reminder server-side:** if `p_day` differs from current `calendar_day` OR `p_slot` differs from current `calendar_slot`, sets `reminder_sent_at = NULL`
- Does NOT reset `reminder_sent_at` when day and slot are unchanged (guards against spurious re-arms on unrelated edits)
- Does NOT touch `reminder_enabled` — flag stays independent
- Only touches `calendar_day`, `calendar_slot`, and conditionally `reminder_sent_at`

---

## 3. Data Changes

### `chore_assignments` — new column
```sql
ALTER TABLE chore_assignments
  ADD COLUMN reminder_sent_at TIMESTAMPTZ NULL;
```

**RLS:** Players may NOT write `reminder_sent_at` directly. Only `toggle_reminder` RPC (SECURITY DEFINER) and `send_reminder_notifications` (pg_cron) write this column.

**Notifications INSERT privilege:** `send_reminder_notifications()` is owned by the `postgres` superuser role (created via migration). Superuser bypasses RLS on all tables — including `notifications`. This is intentional: the function is server-side trusted code, never callable by clients (REVOKE'd from all client roles). Identical pattern to `apply_weekly_penalties()`. The `SET search_path = public` guard prevents search-path injection within the function body.

---

## 4. Notification Content

| Field | Value |
|-------|-------|
| `type` | `reminder` |
| `title_he` | `'תזכורת: ' \|\| chore_title` (from DB join, never user input) |
| `body_he` | `'המשימה שלך מתחילה בקרוב (בוקר-צהריים)'` / `'...(צהריים-אחה"צ)'` / `'...(אחה"צ-ערב)'` |
| `related_entity_id` | assignment ID |
| `user_id` | assignment's `user_id` |
| `family_id` | chore's `family_id` |

No PII stored in notification metadata beyond IDs.

---

## 5. Dedup — Three Guards

1. **`reminder_sent_at IS NULL`** — primary guard checked before insert
2. **`FOR UPDATE` row lock** — prevents double-fire if pg_cron runs overlap
3. **`toggle_reminder` resets on enable only** — re-enabling always re-arms; disabling leaves `reminder_sent_at` unchanged

**Re-arm triggers (two paths):**
1. Player toggles reminder OFF → ON via `toggle_reminder` RPC
2. Player moves assignment to a different day or slot via `reschedule_assignment` RPC — server compares old vs new `calendar_day`/`calendar_slot` and resets `reminder_sent_at = NULL` only when at least one differs

**What does NOT reset `reminder_sent_at`:**
- Edits to unrelated fields (title, coin value, notes)
- Toggling reminder OFF
- Unpinning (day/slot → null): technically a slot change, so reset fires — but reminder won't fire anyway for unslotted assignments

**Reset is always server-side.** Client never writes `reminder_sent_at` directly. No client-side bypass possible.

**UI copy:** Show a hint below the reminder checkbox only when `reminder_enabled=true` AND `reminder_sent_at IS NOT NULL` (reminder already fired for current slot, player hasn't moved or re-toggled): `"תזכורת נשלחה כבר — כבה והדלק מחדש כדי לשלוח שוב"` ("Reminder already sent — toggle off and on to re-arm").

---

## 6. UI Changes

**`WeeklyCalendarPage.tsx` — two changes:**

1. **Reminder toggle:** Replace direct `.update({ reminder_enabled })` with:
```ts
supabase.rpc('toggle_reminder', { p_assignment_id: a.id })
```

2. **Pin/reschedule (`handleDropOnCell` and `handleUnpin`):** Replace direct `.update({ calendar_day, calendar_slot })` with:
```ts
supabase.rpc('reschedule_assignment', {
  p_assignment_id: a.id,
  p_day: day,       // null for unpin
  p_slot: slot,     // null for unpin
})
```
Server handles reminder re-arm comparison. Client never writes `reminder_sent_at`.

Both RPCs: refetch after call. Add error handling: RPC error → show toast.

**Re-arm hint:** Show `"תזכורת נשלחה כבר — כבה והדלק מחדש כדי לשלוח שוב"` below reminder checkbox when `reminder_enabled=true` AND `reminder_sent_at IS NOT NULL`. The hint disappears automatically after re-pin (since `reschedule_assignment` resets `reminder_sent_at`) or after toggle off/on.

No new UI components.

---

## 7. Security Summary

| Threat | Mitigation |
|--------|-----------|
| Unauthorized reminder toggle | `toggle_reminder` checks `auth.uid() = user_id` |
| Client writing `reminder_sent_at` directly | RLS blocks direct column write |
| Cross-family notification insert | JOIN to `chores.family_id` in SQL function |
| Double-fire from overlapping pg_cron | `FOR UPDATE` row lock + `reminder_sent_at IS NULL` guard |
| Injection via chore title in notification | Title sourced from DB join, never from user-supplied input |
| Anon calling toggle_reminder | SECURITY DEFINER callable by `authenticated` only |
| Client bypassing re-arm rule | `reschedule_assignment` RPC does comparison server-side; client cannot write `reminder_sent_at` directly |
| Spurious re-arm on unrelated edit | `reschedule_assignment` only resets when `calendar_day` or `calendar_slot` actually changes |
| Privileged INSERT bypassing RLS | Intentional — postgres-owned SECURITY DEFINER, REVOKE'd from all client roles; `SET search_path = public` prevents injection |
| Double-fire on DST fall-back | `reminder_sent_at IS NULL` guard prevents second fire in repeated hour |

---

## 8. Email Extension (Future)

When email reminders are added:
- Add DB webhook on `notifications INSERT WHERE type = 'reminder'`
- New `send-reminder-email` Edge Function reads assignment + user, sends via Resend
- Zero changes to `send_reminder_notifications()` or `toggle_reminder`

---

## 9. File Map

| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/027_reminder_notifications.sql` | Create | `reminder_sent_at` column, `toggle_reminder` RPC, `reschedule_assignment` RPC, `send_reminder_notifications` function, pg_cron schedule |
| `src/pages/player/calendar/WeeklyCalendarPage.tsx` | Modify | Replace direct updates with `toggle_reminder` + `reschedule_assignment` RPCs; add error toasts; add re-arm hint |
| `src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx` | Modify | Update toggle tests to use `mockRpc`; add RPC error → toast test |

---

## 10. Testing

**SQL migration:** No unit tests. Verify manually via Supabase SQL editor after apply:
```sql
SELECT send_reminder_notifications();
SELECT * FROM notifications WHERE type = 'reminder' ORDER BY created_at DESC LIMIT 5;
```

**WeeklyCalendarPage tests:**
- Reminder toggle calls `mockRpc('toggle_reminder', { p_assignment_id })` — not `mockUpdate`
- Pin/drop calls `mockRpc('reschedule_assignment', { p_assignment_id, p_day, p_slot })`
- Unpin calls `mockRpc('reschedule_assignment', { p_assignment_id, p_day: null, p_slot: null })`
- RPC error on either call → error toast renders
- Re-arm hint renders when `reminder_enabled=true` AND `reminder_sent_at` is non-null
- Re-arm hint absent when `reminder_sent_at` is null
- Existing toggle and pin tests updated to use `mockRpc`

**Full suite:** `npx vitest run` after each task — no regressions.
