# Activity Feed Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time Supabase Realtime subscription to `useActivityFeed` so the player dashboard feed refreshes live when any family member earns an achievement.

**Architecture:** `useActivityFeed` gains a `familyId` parameter and a second `useEffect` that opens a Supabase channel on `player_achievements` INSERT events. On any insert it calls the existing `fetchFeed()`. `PlayerDashboard` passes `profile?.family_id ?? null`. No DB changes needed — RLS on the query already scopes results to the current family.

**Tech Stack:** React, TypeScript, Vitest + @testing-library/react, Supabase JS client (`supabase.channel`, `supabase.removeChannel`)

---

## File Map

| File | Change |
|---|---|
| `src/hooks/useActivityFeed.ts` | Add `familyId: string \| null` param + realtime subscription `useEffect` |
| `src/hooks/__tests__/useActivityFeed.test.ts` | Update existing calls to pass `null`; add 2 new tests |
| `src/pages/player/PlayerDashboard.tsx` | Pass `profile?.family_id ?? null` to `useActivityFeed` |

---

### Task 1: Extend `useActivityFeed` with realtime subscription (TDD)

**Files:**
- Modify: `src/hooks/__tests__/useActivityFeed.test.ts`
- Modify: `src/hooks/useActivityFeed.ts`

---

- [ ] **Step 1: Write failing tests**

Replace the entire contents of `src/hooks/__tests__/useActivityFeed.test.ts` with:

```typescript
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockChannel } from '../../test/mocks/supabase'
import { useActivityFeed } from '../useActivityFeed'

const fakeRow = {
  id: 'pa1',
  earned_at: '2026-04-05T10:00:00Z',
  achievements: { icon: '🏆', title_he: 'משימה ראשונה' },
  profiles: { name: 'דנה', avatar_url: null },
}

function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  }
}

describe('useActivityFeed', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useActivityFeed(null))
    expect(result.current.loading).toBe(true)
    expect(result.current.items).toEqual([])
  })

  it('returns mapped activity items', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeRow], error: null }))
    const { result } = renderHook(() => useActivityFeed(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({
      id: 'pa1',
      profileName: 'דנה',
      achievementIcon: '🏆',
      achievementTitle: 'משימה ראשונה',
      earnedAt: '2026-04-05T10:00:00Z',
    })
    expect(result.current.error).toBeNull()
  })

  it('sets error on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאה' } }))
    const { result } = renderHook(() => useActivityFeed(null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאה')
    expect(result.current.items).toEqual([])
  })

  it('does not subscribe to realtime when familyId is null', () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [], error: null }))
    renderHook(() => useActivityFeed(null))
    expect(mockChannel).not.toHaveBeenCalled()
  })

  it('refetches when a realtime INSERT event fires', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeRow], error: null }))
    const { result } = renderHook(() => useActivityFeed('family-123'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFrom).toHaveBeenCalledTimes(1)

    const channelObj = mockChannel.mock.results[0].value
    const realtimeCallback = channelObj.on.mock.calls[0][2]
    act(() => { realtimeCallback({}) })

    await waitFor(() => expect(mockFrom).toHaveBeenCalledTimes(2))
  })
})
```

- [ ] **Step 2: Run tests — confirm 2 new tests fail**

```bash
cd D:/Claude_Projects/family-chores
npx vitest run src/hooks/__tests__/useActivityFeed.test.ts
```

Expected: the 3 existing tests pass (because the existing hook signature `useActivityFeed()` still accepts no args in JS), but the 2 new tests fail:
- `does not subscribe to realtime when familyId is null` — FAIL (channel called unexpectedly or signature error)
- `refetches when a realtime INSERT event fires` — FAIL

If TypeScript errors appear about the wrong number of arguments, that is expected — it confirms the tests are targeting the new signature.

- [ ] **Step 3: Implement the updated hook**

Replace the entire contents of `src/hooks/useActivityFeed.ts` with:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

interface PlayerAchievementRow {
  id: string
  earned_at: string
  achievements: { icon: string; title_he: string }
  profiles: { name: string; avatar_url: string | null }
}

export interface ActivityItem {
  id: string
  profileName: string
  profileAvatar: string | null
  achievementIcon: string
  achievementTitle: string
  earnedAt: string
}

export interface UseActivityFeedResult {
  items: ActivityItem[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useActivityFeed(familyId: string | null): UseActivityFeedResult {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchFeed = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('player_achievements')
      .select('id, earned_at, achievements!achievement_id(icon, title_he), profiles!user_id(name, avatar_url)')
      .order('earned_at', { ascending: false })
      .limit(20)
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setItems(((data ?? []) as unknown as PlayerAchievementRow[]).map((row) => ({
        id: row.id,
        profileName: row.profiles.name,
        profileAvatar: row.profiles.avatar_url,
        achievementIcon: row.achievements.icon,
        achievementTitle: row.achievements.title_he,
        earnedAt: row.earned_at,
      })))
    }
    setLoading(false)
  // supabase is a stable singleton — no external dependencies needed
  }, [])

  useEffect(() => { fetchFeed() }, [fetchFeed])

  useEffect(() => {
    if (!familyId) return
    const channel = supabase
      .channel(`activity-feed-${familyId}`)
      .on('postgres_changes' as const, {
        event: 'INSERT', schema: 'public', table: 'player_achievements',
      }, () => { fetchFeed() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [familyId, fetchFeed])

  return { items, loading, error, refetch: fetchFeed }
}
```

- [ ] **Step 4: Run tests — confirm all 5 pass**

```bash
npx vitest run src/hooks/__tests__/useActivityFeed.test.ts
```

Expected output:
```
✓ starts in loading state
✓ returns mapped activity items
✓ sets error on failed fetch
✓ does not subscribe to realtime when familyId is null
✓ refetches when a realtime INSERT event fires

Test Files  1 passed (1)
Tests       5 passed (5)
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useActivityFeed.ts src/hooks/__tests__/useActivityFeed.test.ts
git commit -m "feat: add realtime subscription to useActivityFeed"
```

---

### Task 2: Wire `familyId` into PlayerDashboard

**Files:**
- Modify: `src/pages/player/PlayerDashboard.tsx` (line 42)

---

- [ ] **Step 1: Update the hook call**

In `src/pages/player/PlayerDashboard.tsx`, find line 42:

```typescript
  const { items: feedItems } = useActivityFeed()
```

Replace with:

```typescript
  const { items: feedItems } = useActivityFeed(profile?.family_id ?? null)
```

No other changes needed in this file.

- [ ] **Step 2: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass. If a TypeScript error appears in `PlayerDashboard.test.tsx` about `useActivityFeed` (if such a test exists that mocks it), update that mock's call signature to match.

- [ ] **Step 3: Commit**

```bash
git add src/pages/player/PlayerDashboard.tsx
git commit -m "feat: pass familyId to useActivityFeed for scoped realtime channel"
```
