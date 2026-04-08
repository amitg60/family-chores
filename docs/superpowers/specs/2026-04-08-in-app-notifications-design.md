# In-App Notifications — Design Spec

**Date:** 2026-04-08
**Status:** Approved

---

## Overview

Add real-time in-app notifications for players. A bell icon appears in the player header with an unread badge counter. Clicking opens a popover listing all unread notifications. Players can dismiss one at a time or all at once.

Notifications are written automatically via PostgreSQL triggers — no changes to existing app code are required for creation. The frontend consumes them via a hook with a Supabase realtime subscription.

---

## Scope

- **Players only.** No admin notifications in this feature.
- **8 notification types** (all schema types except `reminder`, which would require a cron job).
- **Hebrew text** throughout (`title_he`, `body_he` already on the `notifications` table).

---

## Database Layer

### Migration: `012_notification_triggers.sql`

#### Shared helper function

```sql
insert_notification(
  p_user_id uuid,
  p_family_id uuid,
  p_type notification_type,
  p_title_he text,
  p_body_he text,
  p_related_entity_id uuid DEFAULT NULL
)
```

Inserts into `notifications`. Called by all 8 trigger functions to avoid repetition.

#### Triggers

| Table | Event | Condition | Recipient | `title_he` |
|---|---|---|---|---|
| `chore_assignments` | INSERT | — | `NEW.user_id` | `'הוקצתה לך משימה חדשה'` |
| `chore_completions` | UPDATE | `status` changed to `approved` or `rejected` | `NEW.completed_by` | `'הגשתך אושרה'` / `'הגשתך נדחתה'` |
| `trade_offers` | INSERT | `NEW.offered_to IS NOT NULL` | `NEW.offered_to` | `'קיבלת הצעת עסקה'` |
| `trade_offers` | UPDATE | `status` changed to `accepted` or `declined` | `NEW.offered_by` | `'העסקה שלך התקבלה'` / `'העסקה שלך נדחתה'` |
| `reward_redemptions` | UPDATE | `status` changed to `granted` or `declined` | `NEW.redeemed_by` | `'בקשת המימוש אושרה'` / `'בקשת המימוש נדחתה'` |
| `chores` | UPDATE | `status` changed to `active` (from `pending_approval`) or `archived` (proposed_by IS NOT NULL) | `NEW.proposed_by` | `'הצעת המשימה שלך אושרה'` / `'הצעת המשימה שלך נדחתה'` |
| `penalties` | INSERT | — | `NEW.user_id` | `'הוטל עליך קנס'` |
| `player_achievements` | INSERT | — | `NEW.user_id` | `'זכית בהישג חדש!'` |

Each trigger function also provides a `body_he` string with more detail (e.g., chore title, achievement name) and sets `related_entity_id` to the relevant row's UUID.

`family_id` is resolved by joining to `profiles` or the relevant parent table inside each trigger function.

No new RLS policies needed — existing policies already cover SELECT (users see their own) and UPDATE (users mark their own as read).

---

## Hook: `useNotifications`

**File:** `src/hooks/useNotifications.ts`

### Interface

```typescript
interface Notification {
  id: string
  type: notification_type
  title_he: string
  body_he: string
  related_entity_id: string | null
  read: boolean
  created_at: string
}

interface UseNotificationsResult {
  notifications: Notification[]
  unreadCount: number
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  loading: boolean
}
```

### Behaviour

- **Initial load:** fetches all `read=false` notifications for `auth.uid()`, ordered by `created_at DESC`, limit 50.
- **Realtime:** subscribes to `postgres_changes` INSERT on `notifications` filtered by `user_id=eq.{profile.id}`. New rows are prepended to the list.
- **`markRead(id)`:** updates `read=true` for the given id, removes the notification from the local list.
- **`markAllRead()`:** updates `read=true` for all rows where `user_id = auth.uid()`, clears the local list.
- **Pattern:** `mountedRef + useCallback + useEffect` (consistent with `useFamilyMembers` and other hooks in this codebase).
- **`unreadCount`:** derived as `notifications.length` (list only contains unread items).

### Tests (`src/hooks/__tests__/useNotifications.test.ts`)

- Loading state
- Fetches and displays unread notifications
- Realtime INSERT prepends new notification
- `markRead` removes single notification
- `markAllRead` clears list
- Error handling

---

## UI Component: `NotificationBell`

**File:** `src/components/notifications/NotificationBell.tsx`

### Props

```typescript
interface NotificationBellProps {
  notifications: Notification[]
  unreadCount: number
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}
```

### Structure

- **Bell icon:** `lucide-react` `Bell`, wrapped in a shadcn `Popover` trigger button.
- **Badge:** red circle with `unreadCount` number, positioned top-right of the bell. Hidden when `unreadCount === 0`.
- **Popover content (RTL):**
  - Header row: `"התראות"` label (right) + `"סמן הכל כנקרא"` button (left). Button disabled when list is empty.
  - Scrollable list, `max-h-[400px] overflow-y-auto`.
  - Each notification row: `title_he` (bold) + `body_he` (muted text) + relative timestamp + ✕ button (`aria-label="סגור התראה"`).
  - Empty state: centered text `"אין התראות חדשות"`.

### Tests (`src/components/notifications/__tests__/NotificationBell.test.tsx`)

- Bell renders with badge when unreadCount > 0
- Badge hidden when unreadCount === 0
- Clicking bell opens popover
- Notifications list renders title_he and body_he
- ✕ button calls markRead with correct id
- "סמן הכל כנקרא" calls markAllRead
- Empty state renders when notifications is empty
- "סמן הכל כנקרא" disabled when notifications is empty

---

## Integration: `PlayerLayout`

**File:** `src/components/layout/PlayerLayout.tsx` (modified)

- Call `useNotifications()` at top of component.
- Add `<NotificationBell>` in the header between the `<nav>` and the `"יציאה"` button.

No changes to `AdminLayout`, `router.tsx`, or any existing page/hook.

---

## File Summary

| File | Action |
|---|---|
| `supabase/migrations/012_notification_triggers.sql` | New |
| `src/hooks/useNotifications.ts` | New |
| `src/hooks/__tests__/useNotifications.test.ts` | New |
| `src/components/notifications/NotificationBell.tsx` | New |
| `src/components/notifications/__tests__/NotificationBell.test.tsx` | New |
| `src/components/layout/PlayerLayout.tsx` | Modified (add hook + bell) |

---

## Out of Scope

- `reminder` notification type (requires cron job).
- Admin notifications.
- Push notifications (browser/mobile).
- Notification preferences or settings.
- Marking notifications as read when navigating to the related entity.
