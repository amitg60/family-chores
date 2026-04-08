# In-App Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real-time notification bell to the player header that shows unread in-app notifications written automatically by PostgreSQL triggers on 8 event types.

**Architecture:** PostgreSQL triggers write to the existing `notifications` table automatically when relevant events occur. A `useNotifications` hook fetches the initial unread list and maintains it via a Supabase realtime subscription. `NotificationBell` renders a bell icon with badge counter and popover panel in `PlayerLayout`. No changes to existing RPCs, pages, or admin flows.

**Tech Stack:** React 18, TypeScript, Supabase (postgres_changes realtime), shadcn/ui Popover + Button, lucide-react (Bell, X), Vitest + @testing-library/react

---

## File Map

| File | Action |
|---|---|
| `supabase/migrations/012_notification_triggers.sql` | Create |
| `src/hooks/useNotifications.ts` | Create |
| `src/hooks/__tests__/useNotifications.test.ts` | Create |
| `src/components/notifications/NotificationBell.tsx` | Create |
| `src/components/notifications/__tests__/NotificationBell.test.tsx` | Create |
| `src/components/layout/PlayerLayout.tsx` | Modify |

---

## Reference: Existing Patterns

- Hook pattern: `mountedRef + useCallback + useEffect` — see `src/hooks/useFamilyMembers.ts`
- Supabase mock: `import '../../test/mocks/supabase'` then `import { mockFrom, mockChannel, mockRemoveChannel } from '../../test/mocks/supabase'`
- Component tests: mock hooks at top of file, wrap component in `MemoryRouter` only if it uses routing (NotificationBell does not)
- `Notification` and `NotificationType` are already defined in `src/types/database.ts` — import from there
- Realtime channel pattern (from `PlayerLayout`): `supabase.channel(name).on('postgres_changes', { event, schema, table, filter }, callback).subscribe()`; cleanup via `supabase.removeChannel(channel)`

---

## Task 1: Database Triggers Migration

**Files:**
- Create: `supabase/migrations/012_notification_triggers.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- ============================================================
-- NOTIFICATION INSERT HELPER
-- ============================================================
CREATE OR REPLACE FUNCTION insert_notification(
  p_user_id           uuid,
  p_family_id         uuid,
  p_type              notification_type,
  p_title_he          text,
  p_body_he           text,
  p_related_entity_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
  VALUES (p_user_id, p_family_id, p_type, p_title_he, p_body_he, p_related_entity_id);
END;
$$;

-- ============================================================
-- TRIGGER 1: chore_assigned
-- Fires AFTER INSERT on chore_assignments
-- ============================================================
CREATE OR REPLACE FUNCTION notify_chore_assigned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_chore_title text;
  v_family_id   uuid;
BEGIN
  SELECT title, family_id INTO v_chore_title, v_family_id
  FROM chores WHERE id = NEW.chore_id;

  PERFORM insert_notification(
    NEW.user_id,
    v_family_id,
    'chore_assigned',
    'הוקצתה לך משימה חדשה',
    COALESCE(v_chore_title, 'משימה'),
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_chore_assigned
  AFTER INSERT ON chore_assignments
  FOR EACH ROW EXECUTE FUNCTION notify_chore_assigned();

-- ============================================================
-- TRIGGER 2: completion_reviewed
-- Fires AFTER UPDATE on chore_completions when status → approved/rejected
-- ============================================================
CREATE OR REPLACE FUNCTION notify_completion_reviewed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id uuid;
  v_title_he  text;
  v_body_he   text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved', 'rejected') THEN RETURN NEW; END IF;

  SELECT family_id INTO v_family_id FROM profiles WHERE id = NEW.completed_by;

  IF NEW.status = 'approved' THEN
    v_title_he := 'הגשתך אושרה';
    v_body_he  := 'כל הכבוד! הגשתך אושרה ומטבעות נזכו לחשבונך';
  ELSE
    v_title_he := 'הגשתך נדחתה';
    v_body_he  := COALESCE('הגשתך נדחתה. סיבה: ' || NEW.rejection_reason, 'הגשתך נדחתה');
  END IF;

  PERFORM insert_notification(
    NEW.completed_by, v_family_id, 'completion_reviewed',
    v_title_he, v_body_he, NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_completion_reviewed
  AFTER UPDATE ON chore_completions
  FOR EACH ROW EXECUTE FUNCTION notify_completion_reviewed();

-- ============================================================
-- TRIGGER 3: trade_received
-- Fires AFTER INSERT on trade_offers when offered_to IS NOT NULL
-- ============================================================
CREATE OR REPLACE FUNCTION notify_trade_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sender_name text;
BEGIN
  IF NEW.offered_to IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO v_sender_name FROM profiles WHERE id = NEW.offered_by;

  PERFORM insert_notification(
    NEW.offered_to, NEW.family_id, 'trade_received',
    'קיבלת הצעת עסקה',
    COALESCE(v_sender_name, 'מישהו') || ' שלח/ה לך הצעת עסקה',
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_trade_received
  AFTER INSERT ON trade_offers
  FOR EACH ROW EXECUTE FUNCTION notify_trade_received();

-- ============================================================
-- TRIGGER 4: trade_resolved
-- Fires AFTER UPDATE on trade_offers when status → accepted/declined
-- ============================================================
CREATE OR REPLACE FUNCTION notify_trade_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_title_he text;
  v_body_he  text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('accepted', 'declined') THEN RETURN NEW; END IF;

  IF NEW.status = 'accepted' THEN
    v_title_he := 'העסקה שלך התקבלה';
    v_body_he  := 'הצעת העסקה שלך התקבלה';
  ELSE
    v_title_he := 'העסקה שלך נדחתה';
    v_body_he  := 'הצעת העסקה שלך נדחתה';
  END IF;

  PERFORM insert_notification(
    NEW.offered_by, NEW.family_id, 'trade_resolved',
    v_title_he, v_body_he, NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_trade_resolved
  AFTER UPDATE ON trade_offers
  FOR EACH ROW EXECUTE FUNCTION notify_trade_resolved();

-- ============================================================
-- TRIGGER 5: redemption_resolved
-- Fires AFTER UPDATE on reward_redemptions when status → granted/declined
-- ============================================================
CREATE OR REPLACE FUNCTION notify_redemption_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id   uuid;
  v_reward_title text;
  v_title_he    text;
  v_body_he     text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('granted', 'declined') THEN RETURN NEW; END IF;

  SELECT r.family_id, r.title INTO v_family_id, v_reward_title
  FROM rewards r WHERE r.id = NEW.reward_id;

  IF NEW.status = 'granted' THEN
    v_title_he := 'בקשת המימוש אושרה';
    v_body_he  := 'בקשת המימוש שלך עבור "' || COALESCE(v_reward_title, 'הפרס') || '" אושרה';
  ELSE
    v_title_he := 'בקשת המימוש נדחתה';
    v_body_he  := 'בקשת המימוש שלך עבור "' || COALESCE(v_reward_title, 'הפרס') || '" נדחתה';
  END IF;

  PERFORM insert_notification(
    NEW.redeemed_by, v_family_id, 'redemption_resolved',
    v_title_he, v_body_he, NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_redemption_resolved
  AFTER UPDATE ON reward_redemptions
  FOR EACH ROW EXECUTE FUNCTION notify_redemption_resolved();

-- ============================================================
-- TRIGGER 6: proposal_resolved
-- Fires AFTER UPDATE on chores when status changes from pending_approval
-- Only when proposed_by IS NOT NULL (i.e., player-proposed chore)
-- ============================================================
CREATE OR REPLACE FUNCTION notify_proposal_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_title_he text;
  v_body_he  text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.proposed_by IS NULL THEN RETURN NEW; END IF;
  IF OLD.status != 'pending_approval' THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('active', 'archived') THEN RETURN NEW; END IF;

  IF NEW.status = 'active' THEN
    v_title_he := 'הצעת המשימה שלך אושרה';
    v_body_he  := '"' || NEW.title || '" אושרה ונוספה לרשימת המשימות';
  ELSE
    v_title_he := 'הצעת המשימה שלך נדחתה';
    v_body_he  := '"' || NEW.title || '" נדחתה על ידי המנהל';
  END IF;

  PERFORM insert_notification(
    NEW.proposed_by, NEW.family_id, 'proposal_resolved',
    v_title_he, v_body_he, NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_proposal_resolved
  AFTER UPDATE ON chores
  FOR EACH ROW EXECUTE FUNCTION notify_proposal_resolved();

-- ============================================================
-- TRIGGER 7: penalty_applied
-- Fires AFTER INSERT on penalties
-- ============================================================
CREATE OR REPLACE FUNCTION notify_penalty_applied()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id FROM profiles WHERE id = NEW.user_id;

  PERFORM insert_notification(
    NEW.user_id, v_family_id, 'penalty_applied',
    'הוטל עליך קנס',
    'נוכו ' || NEW.coin_deduction || ' מטבעות. סיבה: ' || NEW.reason,
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_penalty_applied
  AFTER INSERT ON penalties
  FOR EACH ROW EXECUTE FUNCTION notify_penalty_applied();

-- ============================================================
-- TRIGGER 8: achievement_earned
-- Fires AFTER INSERT on player_achievements
-- ============================================================
CREATE OR REPLACE FUNCTION notify_achievement_earned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id  uuid;
  v_title_he   text;
  v_icon       text;
BEGIN
  SELECT family_id INTO v_family_id FROM profiles WHERE id = NEW.user_id;
  SELECT title_he, icon INTO v_title_he, v_icon
  FROM achievements WHERE id = NEW.achievement_id;

  PERFORM insert_notification(
    NEW.user_id, v_family_id, 'achievement_earned',
    'זכית בהישג חדש!',
    COALESCE(v_icon || ' ', '') || COALESCE(v_title_he, 'הישג חדש'),
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_achievement_earned
  AFTER INSERT ON player_achievements
  FOR EACH ROW EXECUTE FUNCTION notify_achievement_earned();
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/012_notification_triggers.sql
git commit -m "feat: add notification triggers for 8 event types"
```

---

## Task 2: useNotifications Hook (TDD)

**Files:**
- Create: `src/hooks/__tests__/useNotifications.test.ts`
- Create: `src/hooks/useNotifications.ts`

The hook returns `{ notifications, unreadCount, markRead, markAllRead, loading }`.
- `notifications`: only unread rows (read=false), newest first, limit 50
- `unreadCount`: derived as `notifications.length`
- `markRead(id)`: UPDATE read=true, remove from list
- `markAllRead()`: UPDATE all for user, clear list
- Realtime: subscribes to INSERT on `notifications` filtered to current user; prepends new rows

### Supabase mock chain reference

**Initial fetch** — `from → select → eq → order → limit → resolves`:
```typescript
mockFrom.mockReturnValueOnce({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
})
```

**markRead** — `from → update → eq → resolves`:
```typescript
mockFrom.mockReturnValueOnce({
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockResolvedValue({ error: null }),
})
```

**markAllRead** — `from → update → eq → eq → resolves` (two eq calls):
```typescript
const secondEq = vi.fn().mockResolvedValue({ error: null })
const firstEq  = vi.fn().mockReturnValue({ eq: secondEq })
mockFrom.mockReturnValueOnce({
  update: vi.fn().mockReturnValue({ eq: firstEq }),
})
```

**Realtime callback capture** — after rendering the hook:
```typescript
// mockChannel.mock.results[0].value is the channel object returned by supabase.channel(...)
// .on mock captures the callback at call index [0][2] (event, filter, callback)
const channelObj = mockChannel.mock.results[0].value
const realtimeCallback = channelObj.on.mock.calls[0][2]
// Then trigger it:
act(() => realtimeCallback({ new: newNotification }))
```

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/__tests__/useNotifications.test.ts`:

```typescript
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockChannel, mockRemoveChannel } from '../../test/mocks/supabase'
import type { Notification } from '../../types/database'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'user1', family_id: 'fam1', name: 'Test',
      avatar_url: null, role: 'player' as const, trust_level: 1,
      coin_balance: 0, created_at: '', updated_at: '',
    },
  }),
}))

const n1: Notification = {
  id: 'n1', user_id: 'user1', family_id: 'fam1',
  type: 'chore_assigned', title_he: 'הוקצתה לך משימה חדשה',
  body_he: 'משימה', related_entity_id: null, read: false,
  created_at: '2026-04-08T10:00:00Z',
}
const n2: Notification = {
  id: 'n2', user_id: 'user1', family_id: 'fam1',
  type: 'achievement_earned', title_he: 'זכית בהישג חדש!',
  body_he: '🏆 משימה ראשונה', related_entity_id: null, read: false,
  created_at: '2026-04-08T09:00:00Z',
}

function setupFetchMock(rows: Notification[], error: { message: string } | null = null) {
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: error ? null : rows, error }),
  })
}

// Import after mocks are set up
import { useNotifications } from '../useNotifications'

describe('useNotifications', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useNotifications())
    expect(result.current.loading).toBe(true)
    expect(result.current.notifications).toEqual([])
    expect(result.current.unreadCount).toBe(0)
  })

  it('fetches unread notifications on mount and derives unreadCount', async () => {
    setupFetchMock([n1, n2])
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.notifications).toEqual([n1, n2])
    expect(result.current.unreadCount).toBe(2)
  })

  it('prepends new notification when realtime INSERT arrives', async () => {
    setupFetchMock([n1])
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const channelObj = mockChannel.mock.results[0].value
    const realtimeCallback = channelObj.on.mock.calls[0][2]

    act(() => realtimeCallback({ new: n2 }))

    expect(result.current.notifications[0]).toEqual(n2)
    expect(result.current.notifications[1]).toEqual(n1)
    expect(result.current.unreadCount).toBe(2)
  })

  it('markRead removes notification from list', async () => {
    setupFetchMock([n1, n2])
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockFrom.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    await act(async () => {
      await result.current.markRead('n1')
    })

    expect(result.current.notifications).toEqual([n2])
    expect(result.current.unreadCount).toBe(1)
  })

  it('markAllRead clears the notification list', async () => {
    setupFetchMock([n1, n2])
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const secondEq = vi.fn().mockResolvedValue({ error: null })
    const firstEq  = vi.fn().mockReturnValue({ eq: secondEq })
    mockFrom.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({ eq: firstEq }),
    })

    await act(async () => {
      await result.current.markAllRead()
    })

    expect(result.current.notifications).toEqual([])
    expect(result.current.unreadCount).toBe(0)
  })

  it('cleans up realtime channel on unmount', async () => {
    setupFetchMock([])
    const { unmount } = renderHook(() => useNotifications())
    await waitFor(() => expect(mockChannel).toHaveBeenCalled())
    unmount()
    expect(mockRemoveChannel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
npx vitest run src/hooks/__tests__/useNotifications.test.ts
```

Expected: FAIL — `Cannot find module '../useNotifications'`

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useNotifications.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Notification } from '../types/database'

interface UseNotificationsResult {
  notifications: Notification[]
  unreadCount: number
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  loading: boolean
}

export function useNotifications(): UseNotificationsResult {
  const { profile } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (!profile?.id) return
    setLoading(true)
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(50)
    if (!mountedRef.current) return
    setNotifications((data as Notification[]) ?? [])
    setLoading(false)
  }, [profile?.id])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase
      .channel(`notifications-${profile.id}`)
      .on(
        'postgres_changes' as const,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload: RealtimePostgresInsertPayload<Notification>) => {
          if (!mountedRef.current) return
          setNotifications(prev => [payload.new as Notification, ...prev])
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id])

  const markRead = useCallback(async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    if (mountedRef.current) {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }
  }, [])

  const markAllRead = useCallback(async () => {
    if (!profile?.id) return
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', profile.id)
      .eq('read', false)
    if (mountedRef.current) {
      setNotifications([])
    }
  }, [profile?.id])

  return {
    notifications,
    unreadCount: notifications.length,
    markRead,
    markAllRead,
    loading,
  }
}
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
npx vitest run src/hooks/__tests__/useNotifications.test.ts
```

Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNotifications.ts src/hooks/__tests__/useNotifications.test.ts
git commit -m "feat: add useNotifications hook with realtime subscription"
```

---

## Task 3: NotificationBell Component (TDD)

**Files:**
- Create: `src/components/notifications/__tests__/NotificationBell.test.tsx`
- Create: `src/components/notifications/NotificationBell.tsx`

The component receives props (no internal data fetching). It renders:
- A `Bell` icon button with a red badge showing `unreadCount` (hidden when 0)
- A shadcn `Popover` panel with notification list, dismiss buttons, and dismiss-all
- An empty state when there are no notifications
- `aria-label="פתח התראות"` on the bell button

- [ ] **Step 1: Write the failing tests**

Create `src/components/notifications/__tests__/NotificationBell.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Notification } from '../../../types/database'
import NotificationBell from '../NotificationBell'

const mockMarkRead = vi.fn()
const mockMarkAllRead = vi.fn()

const n1: Notification = {
  id: 'n1', user_id: 'u1', family_id: 'f1',
  type: 'chore_assigned', title_he: 'הוקצתה לך משימה חדשה',
  body_he: 'ניקוי חדר', related_entity_id: null, read: false,
  created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 mins ago
}
const n2: Notification = {
  id: 'n2', user_id: 'u1', family_id: 'f1',
  type: 'achievement_earned', title_he: 'זכית בהישג חדש!',
  body_he: '🏆 משימה ראשונה', related_entity_id: null, read: false,
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hrs ago
}

function renderBell(notifications: Notification[], unreadCount: number) {
  return render(
    <NotificationBell
      notifications={notifications}
      unreadCount={unreadCount}
      markRead={mockMarkRead}
      markAllRead={mockMarkAllRead}
    />
  )
}

describe('NotificationBell', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows badge with unreadCount when > 0', () => {
    renderBell([n1, n2], 2)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('hides badge when unreadCount is 0', () => {
    renderBell([], 0)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('opens popover and shows notifications when bell is clicked', () => {
    renderBell([n1, n2], 2)
    fireEvent.click(screen.getByRole('button', { name: 'פתח התראות' }))
    expect(screen.getByText('התראות')).toBeInTheDocument()
    expect(screen.getByText('הוקצתה לך משימה חדשה')).toBeInTheDocument()
    expect(screen.getByText('ניקוי חדר')).toBeInTheDocument()
    expect(screen.getByText('זכית בהישג חדש!')).toBeInTheDocument()
  })

  it('calls markRead with notification id when dismiss button clicked', () => {
    renderBell([n1], 1)
    fireEvent.click(screen.getByRole('button', { name: 'פתח התראות' }))
    fireEvent.click(screen.getByRole('button', { name: 'סגור התראה' }))
    expect(mockMarkRead).toHaveBeenCalledWith('n1')
  })

  it('calls markAllRead when "סמן הכל כנקרא" is clicked', () => {
    renderBell([n1, n2], 2)
    fireEvent.click(screen.getByRole('button', { name: 'פתח התראות' }))
    fireEvent.click(screen.getByRole('button', { name: 'סמן הכל כנקרא' }))
    expect(mockMarkAllRead).toHaveBeenCalled()
  })

  it('disables "סמן הכל כנקרא" when notifications list is empty', () => {
    renderBell([], 0)
    fireEvent.click(screen.getByRole('button', { name: 'פתח התראות' }))
    expect(screen.getByRole('button', { name: 'סמן הכל כנקרא' })).toBeDisabled()
  })

  it('shows empty state when no notifications', () => {
    renderBell([], 0)
    fireEvent.click(screen.getByRole('button', { name: 'פתח התראות' }))
    expect(screen.getByText('אין התראות חדשות')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
npx vitest run src/components/notifications/__tests__/NotificationBell.test.tsx
```

Expected: FAIL — `Cannot find module '../NotificationBell'`

- [ ] **Step 3: Implement the component**

Create `src/components/notifications/NotificationBell.tsx`:

```typescript
import { Bell, X } from 'lucide-react'
import { Button } from '../ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover'
import type { Notification } from '../../types/database'

interface NotificationBellProps {
  notifications: Notification[]
  unreadCount: number
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'עכשיו'
  if (minutes < 60) return `לפני ${minutes} דקות`
  if (hours < 24) return `לפני ${hours} שעות`
  if (days === 1) return 'אתמול'
  return `לפני ${days} ימים`
}

export default function NotificationBell({
  notifications,
  unreadCount,
  markRead,
  markAllRead,
}: NotificationBellProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="פתח התראות"
          className="relative"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" dir="rtl">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="font-semibold text-sm">התראות</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={markAllRead}
            disabled={notifications.length === 0}
          >
            סמן הכל כנקרא
          </Button>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-6">
              אין התראות חדשות
            </p>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                className="flex items-start gap-2 px-3 py-2 border-b last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{n.title_he}</p>
                  <p className="text-xs text-muted-foreground">{n.body_he}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatRelativeTime(n.created_at)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0 mt-0.5"
                  onClick={() => markRead(n.id)}
                  aria-label="סגור התראה"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 4: Run tests — verify they PASS**

```bash
npx vitest run src/components/notifications/__tests__/NotificationBell.test.tsx
```

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/components/notifications/NotificationBell.tsx src/components/notifications/__tests__/NotificationBell.test.tsx
git commit -m "feat: add NotificationBell component with popover and dismiss controls"
```

---

## Task 4: Wire Up PlayerLayout

**Files:**
- Modify: `src/components/layout/PlayerLayout.tsx`

Add `useNotifications()` call and render `<NotificationBell>` in the header between `<nav>` and the "יציאה" button. No other changes.

- [ ] **Step 1: Modify PlayerLayout.tsx**

Add two imports at the top (after existing imports):

```typescript
import { useNotifications } from '../../hooks/useNotifications'
import NotificationBell from '../notifications/NotificationBell'
```

Add the hook call inside the component body, after the existing `const { toast } = useToast()` line:

```typescript
const { notifications, unreadCount, markRead, markAllRead } = useNotifications()
```

Replace the closing `</nav>` + `<Button>` section (currently lines ~129–132) with:

```tsx
        </nav>
        <div className="flex items-center gap-2">
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            markRead={markRead}
            markAllRead={markAllRead}
          />
          <Button variant="outline" size="sm" onClick={signOut}>
            יציאה
          </Button>
        </div>
```

The full updated return JSX for the header area (for reference, lines 56–133 after the change):

```tsx
  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between">
        <Link to="/player/profile" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <Avatar className="h-8 w-8">
            <AvatarImage src={profile?.avatar_url ?? undefined} />
            <AvatarFallback>{profile?.name?.[0] ?? 'מ'}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-semibold text-sm">{profile?.name}</span>
            <span className="text-xs text-muted-foreground">
              🪙 {profile?.coin_balance ?? 0} מטבעות
            </span>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-2">
          {/* ... all existing NavLinks unchanged ... */}
        </nav>
        <div className="flex items-center gap-2">
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            markRead={markRead}
            markAllRead={markAllRead}
          />
          <Button variant="outline" size="sm" onClick={signOut}>
            יציאה
          </Button>
        </div>
      </header>
      <main className="p-4 max-w-4xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
```

- [ ] **Step 2: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests pass (existing tests unaffected; 204+ tests passing).

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/PlayerLayout.tsx
git commit -m "feat: add notification bell to player header"
```
