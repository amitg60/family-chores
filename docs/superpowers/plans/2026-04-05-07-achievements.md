# Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the achievements system: award 7 predefined achievements automatically when events occur, display them on a player page, show toasts when earned, add an activity feed to the player dashboard, and broadcast achievements to all online family members via Supabase Realtime.

**Architecture:** No new tables needed — `achievements` (seeded with 7 rows), `player_achievements`, and all RLS policies already exist except the INSERT policy. Achievements are checked client-side on PlayerDashboard load using data from a new `useAchievements` hook. A pure `checkAndAwardAchievements` utility evaluates thresholds and INSERTs to `player_achievements`. The activity feed is a separate hook querying recent family achievements. Realtime announcements use `supabase.channel()` with Postgres CDC in PlayerLayout.

**Tech Stack:** React 18, TypeScript, Tailwind, shadcn/ui (Card, Badge, Toast), Supabase JS v2 (Realtime + Postgres), Vitest + React Testing Library

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/010_achievement_rls.sql` | Create | INSERT policy so players can earn their own achievements |
| `src/App.tsx` | Modify | Mount `<Toaster />` globally |
| `src/test/mocks/supabase.ts` | Modify | Add `channel` + `removeChannel` to mock |
| `src/hooks/useAchievements.ts` | Create | Fetch all achievements + player earned status + total completed count |
| `src/hooks/__tests__/useAchievements.test.ts` | Create | 5 hook tests |
| `src/lib/checkAchievements.ts` | Create | Pure utility: evaluate thresholds and INSERT new awards |
| `src/lib/__tests__/checkAchievements.test.ts` | Create | 6 utility tests |
| `src/hooks/useActivityFeed.ts` | Create | Fetch recent family achievement events for the activity strip |
| `src/hooks/__tests__/useActivityFeed.test.ts` | Create | 3 hook tests |
| `src/pages/player/achievements/AchievementsPage.tsx` | Create | Grid showing earned vs locked achievements |
| `src/pages/player/achievements/__tests__/AchievementsPage.test.tsx` | Create | 5 page tests |
| `src/pages/player/PlayerDashboard.tsx` | Modify | Add achievement checking + activity feed |
| `src/pages/player/__tests__/PlayerDashboard.test.tsx` | Modify | Add 2 tests for new behavior |
| `src/components/layout/PlayerLayout.tsx` | Modify | Add "הישגים" nav link + Realtime subscription |
| `src/router.tsx` | Modify | Add `/player/achievements` route |

---

## Context for Implementers

### Existing Types (from `src/types/database.ts`)

```typescript
export type AchievementTrigger = 'chore_count' | 'coin_total' | 'trade_count' | 'trust_level' | 'weekly_top' | 'streak'

export interface Achievement {
  id: string
  key: string
  title_he: string
  description_he: string
  icon: string
  trigger_type: AchievementTrigger
  threshold: number
  created_at: string
}

export interface PlayerAchievement {
  id: string
  user_id: string
  achievement_id: string
  earned_at: string
}

export interface Profile {
  id: string
  family_id: string | null
  name: string
  avatar_url: string | null
  role: UserRole
  trust_level: number
  coin_balance: number
  created_at: string
  updated_at: string
}
```

### Seeded Achievements (7 rows — already in DB)

| key | title_he | icon | trigger_type | threshold |
|---|---|---|---|---|
| `first_chore` | משימה ראשונה | 🏆 | chore_count | 1 |
| `five_chores_week` | 5 משימות בשבוע | 🔥 | chore_count | 5 |
| `hundred_coins` | 100 מטבעות | 💰 | coin_total | 100 |
| `first_trade` | עסקה ראשונה | 🤝 | trade_count | 1 |
| `trust_upgrade` | שדרוג אמון | ⭐ | trust_level | 2 |
| `weekly_top` | מוביל השבוע | 👑 | weekly_top | 1 |
| `perfect_week` | שבוע מושלם | 🗓️ | streak | 1 |

**Note:** Only `chore_count` and `coin_total` achievements are evaluated in this plan. The others (`trade_count`, `trust_level`, `weekly_top`, `streak`) require features not yet built — leave them as locked on the page.

### Supabase mock file location

All test files import the mock as:
- From `src/hooks/__tests__/`: `'../../test/mocks/supabase'`
- From `src/lib/__tests__/`: `'../../test/mocks/supabase'`
- From `src/pages/player/__tests__/`: `'../../../test/mocks/supabase'`
- From `src/pages/player/achievements/__tests__/`: `'../../../../test/mocks/supabase'`

### Hook pattern (established in codebase)

```typescript
const mountedRef = useRef(true)
useEffect(() => {
  mountedRef.current = true
  return () => { mountedRef.current = false }
}, [])
const fetchX = useCallback(async () => { ... }, [deps])
useEffect(() => { fetchX() }, [fetchX])
```

### Running all tests

```bash
cd D:/Claude_Projects/family-chores && npx vitest run --reporter=verbose 2>&1 | tail -10
```

---

## Task 1: DB Migration + Toaster + Mock Update

**Files:**
- Create: `supabase/migrations/010_achievement_rls.sql`
- Modify: `src/App.tsx`
- Modify: `src/test/mocks/supabase.ts`

No TDD here — migration SQL can't be unit-tested, App.tsx change is trivial, and the mock update just adds exports. Instead: write all three, then run the full test suite to confirm nothing broke.

- [ ] **Step 1: Create the migration**

Write this exact content to `supabase/migrations/010_achievement_rls.sql`:

```sql
-- Players can insert their own achievement records
CREATE POLICY "player_achievements: players can earn"
  ON player_achievements FOR INSERT
  WITH CHECK (user_id = auth.uid());
```

- [ ] **Step 2: Update `src/App.tsx` to mount Toaster globally**

Write this exact content to `src/App.tsx`:

```tsx
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { Toaster } from './components/ui/toaster'

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  )
}
```

- [ ] **Step 3: Update `src/test/mocks/supabase.ts` to add Realtime mocks**

Write this exact content to `src/test/mocks/supabase.ts`:

```typescript
import { vi } from 'vitest'

const {
  mockGetSession,
  mockSignInWithPassword,
  mockSignOut,
  mockOnAuthStateChange,
  mockFrom,
  mockRpc,
  mockStorageFrom,
  mockChannel,
  mockRemoveChannel,
} = vi.hoisted(() => {
  const mockChannelObj = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  }
  return {
    mockGetSession: vi.fn(),
    mockSignInWithPassword: vi.fn(),
    mockSignOut: vi.fn(),
    mockOnAuthStateChange: vi.fn(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    })),
    mockFrom: vi.fn(),
    mockRpc: vi.fn(),
    mockStorageFrom: vi.fn(),
    mockChannel: vi.fn().mockReturnValue(mockChannelObj),
    mockRemoveChannel: vi.fn(),
  }
})

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      onAuthStateChange: mockOnAuthStateChange,
    },
    from: mockFrom,
    rpc: mockRpc,
    storage: {
      from: mockStorageFrom,
    },
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}))

export {
  mockGetSession,
  mockSignInWithPassword,
  mockSignOut,
  mockOnAuthStateChange,
  mockFrom,
  mockRpc,
  mockStorageFrom,
  mockChannel,
  mockRemoveChannel,
}
```

- [ ] **Step 4: Run all tests to verify nothing broke**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all 157 existing tests still pass.

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add supabase/migrations/010_achievement_rls.sql src/App.tsx src/test/mocks/supabase.ts && git commit -m "feat: add achievement INSERT policy, mount Toaster, add Realtime mock"
```

---

## Task 2: `useAchievements` Hook

**Files:**
- Create: `src/hooks/useAchievements.ts`
- Create: `src/hooks/__tests__/useAchievements.test.ts`

The hook runs 3 parallel Supabase queries: all achievements, this player's earned achievements, and this player's total completed chore count.

- [ ] **Step 1: Write the failing test**

Write this exact content to `src/hooks/__tests__/useAchievements.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useAchievements } from '../useAchievements'
import type { Achievement, PlayerAchievement } from '../../types/database'

const fakeAchievement: Achievement = {
  id: 'ach1',
  key: 'first_chore',
  title_he: 'משימה ראשונה',
  description_he: 'השלמת את המשימה הראשונה שלך!',
  icon: '🏆',
  trigger_type: 'chore_count',
  threshold: 1,
  created_at: '2026-04-01T00:00:00Z',
}

const fakePlayerAchievement: PlayerAchievement = {
  id: 'pa1',
  user_id: 'u1',
  achievement_id: 'ach1',
  earned_at: '2026-04-05T10:00:00Z',
}

function setupMocks(
  allAchievements: Achievement[],
  playerAchievements: PlayerAchievement[],
  count: number,
  err1: null | { message: string } = null,
  err2: null | { message: string } = null,
  err3: null | { message: string } = null,
) {
  mockFrom
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: err1 ? null : allAchievements, error: err1 }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: err2 ? null : playerAchievements, error: err2 }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ count: err3 ? null : count, data: null, error: err3 }),
      }),
    })
}

describe('useAchievements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom
      .mockReturnValueOnce({ select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnValue(new Promise(() => {})) })
      .mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue(new Promise(() => {})) })
      .mockReturnValueOnce({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue(new Promise(() => {})) }) })
    const { result } = renderHook(() => useAchievements('u1'))
    expect(result.current.loading).toBe(true)
    expect(result.current.achievements).toEqual([])
  })

  it('returns merged achievements with earned status', async () => {
    setupMocks([fakeAchievement], [fakePlayerAchievement], 3)
    const { result } = renderHook(() => useAchievements('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.achievements).toHaveLength(1)
    expect(result.current.achievements[0].earned_at).toBe('2026-04-05T10:00:00Z')
    expect(result.current.achievements[0].player_achievement_id).toBe('pa1')
    expect(result.current.error).toBeNull()
  })

  it('sets earnedIds and totalCompletedAllTime', async () => {
    setupMocks([fakeAchievement], [fakePlayerAchievement], 5)
    const { result } = renderHook(() => useAchievements('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.earnedIds.has('ach1')).toBe(true)
    expect(result.current.totalCompletedAllTime).toBe(5)
  })

  it('sets error when any query fails', async () => {
    setupMocks([], [], 0, { message: 'DB down' })
    const { result } = renderHook(() => useAchievements('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB down')
  })

  it('returns empty results when userId is undefined', async () => {
    const { result } = renderHook(() => useAchievements(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.achievements).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/hooks/__tests__/useAchievements.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL — `useAchievements` not found.

- [ ] **Step 3: Write the hook**

Write this exact content to `src/hooks/useAchievements.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Achievement, PlayerAchievement } from '../types/database'

export interface AchievementWithStatus extends Achievement {
  earned_at: string | null
  player_achievement_id: string | null
}

export interface UseAchievementsResult {
  achievements: AchievementWithStatus[]
  earnedIds: Set<string>
  totalCompletedAllTime: number
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useAchievements(userId: string | undefined): UseAchievementsResult {
  const [achievements, setAchievements] = useState<AchievementWithStatus[]>([])
  const [earnedIds, setEarnedIds] = useState<Set<string>>(new Set())
  const [totalCompletedAllTime, setTotalCompletedAllTime] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchAchievements = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    const [
      { data: allData, error: err1 },
      { data: earnedData, error: err2 },
      { count: totalCount, error: err3 },
    ] = await Promise.all([
      supabase.from('achievements').select('*').order('threshold', { ascending: true }),
      supabase.from('player_achievements').select('*').eq('user_id', userId),
      supabase.from('chore_assignments').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'completed'),
    ])

    if (!mountedRef.current) return

    if (err1 || err2 || err3) {
      setError((err1 ?? err2 ?? err3)!.message)
      setLoading(false)
      return
    }

    const earnedMap = new Map((earnedData ?? []).map((pa: PlayerAchievement) => [pa.achievement_id, pa]))
    setAchievements((allData ?? []).map((a: Achievement) => ({
      ...a,
      earned_at: earnedMap.get(a.id)?.earned_at ?? null,
      player_achievement_id: earnedMap.get(a.id)?.id ?? null,
    })))
    setEarnedIds(new Set((earnedData ?? []).map((pa: PlayerAchievement) => pa.achievement_id)))
    setTotalCompletedAllTime(totalCount ?? 0)
    setLoading(false)
  // supabase is a stable singleton — no external dependencies needed
  }, [userId])

  useEffect(() => { fetchAchievements() }, [fetchAchievements])

  return { achievements, earnedIds, totalCompletedAllTime, loading, error, refetch: fetchAchievements }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/hooks/__tests__/useAchievements.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/hooks/useAchievements.ts src/hooks/__tests__/useAchievements.test.ts && git commit -m "feat: add useAchievements hook with merged earned status and completed count"
```

---

## Task 3: `checkAndAwardAchievements` Utility

**Files:**
- Create: `src/lib/checkAchievements.ts`
- Create: `src/lib/__tests__/checkAchievements.test.ts`

A pure-ish utility (calls Supabase INSERT) that takes current player state and awards any newly eligible achievements. Only `chore_count` and `coin_total` trigger types are evaluated — the other trigger types require features not yet built.

- [ ] **Step 1: Write the failing tests**

Write this exact content to `src/lib/__tests__/checkAchievements.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { checkAndAwardAchievements } from '../checkAchievements'
import type { AchievementWithStatus } from '../../hooks/useAchievements'

const makeAchievement = (overrides: Partial<AchievementWithStatus>): AchievementWithStatus => ({
  id: 'ach1',
  key: 'first_chore',
  title_he: 'משימה ראשונה',
  description_he: 'השלמת את המשימה הראשונה שלך!',
  icon: '🏆',
  trigger_type: 'chore_count',
  threshold: 1,
  created_at: '2026-04-01T00:00:00Z',
  earned_at: null,
  player_achievement_id: null,
  ...overrides,
})

const baseParams = {
  userId: 'u1',
  familyId: 'f1',
  coinBalance: 10,
  completedThisWeek: 0,
  totalCompletedAllTime: 0,
  earnedIds: new Set<string>(),
}

describe('checkAndAwardAchievements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('awards first_chore when totalCompletedAllTime >= threshold', async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    const result = await checkAndAwardAchievements({
      ...baseParams,
      totalCompletedAllTime: 1,
      achievements: [makeAchievement({ key: 'first_chore', trigger_type: 'chore_count', threshold: 1 })],
    })
    expect(result).toEqual(['first_chore'])
    expect(mockFrom).toHaveBeenCalledWith('player_achievements')
  })

  it('awards five_chores_week when completedThisWeek >= threshold', async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    const result = await checkAndAwardAchievements({
      ...baseParams,
      completedThisWeek: 5,
      achievements: [makeAchievement({ key: 'five_chores_week', trigger_type: 'chore_count', threshold: 5 })],
    })
    expect(result).toEqual(['five_chores_week'])
  })

  it('awards hundred_coins when coinBalance >= threshold', async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    const result = await checkAndAwardAchievements({
      ...baseParams,
      coinBalance: 150,
      achievements: [makeAchievement({ key: 'hundred_coins', trigger_type: 'coin_total', threshold: 100 })],
    })
    expect(result).toEqual(['hundred_coins'])
  })

  it('does not award already-earned achievements', async () => {
    const result = await checkAndAwardAchievements({
      ...baseParams,
      totalCompletedAllTime: 1,
      earnedIds: new Set(['ach1']),
      achievements: [makeAchievement({ id: 'ach1', key: 'first_chore', trigger_type: 'chore_count', threshold: 1 })],
    })
    expect(result).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns empty array when threshold not met', async () => {
    const result = await checkAndAwardAchievements({
      ...baseParams,
      totalCompletedAllTime: 0,
      achievements: [makeAchievement({ key: 'first_chore', trigger_type: 'chore_count', threshold: 1 })],
    })
    expect(result).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('silently skips insert-failed achievements', async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: 'unique violation' } }) })
    const result = await checkAndAwardAchievements({
      ...baseParams,
      totalCompletedAllTime: 1,
      achievements: [makeAchievement({ key: 'first_chore', trigger_type: 'chore_count', threshold: 1 })],
    })
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/lib/__tests__/checkAchievements.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the utility**

Write this exact content to `src/lib/checkAchievements.ts`:

```typescript
import { supabase } from './supabase'
import type { AchievementWithStatus } from '../hooks/useAchievements'

export interface CheckAchievementsParams {
  userId: string
  familyId: string
  coinBalance: number
  completedThisWeek: number
  totalCompletedAllTime: number
  earnedIds: Set<string>
  achievements: AchievementWithStatus[]
}

export async function checkAndAwardAchievements(params: CheckAchievementsParams): Promise<string[]> {
  const unearned = params.achievements.filter(a => !params.earnedIds.has(a.id))
  const toAward: AchievementWithStatus[] = []

  for (const a of unearned) {
    let shouldAward = false
    if (a.trigger_type === 'chore_count') {
      if (a.key === 'first_chore') shouldAward = params.totalCompletedAllTime >= a.threshold
      else if (a.key === 'five_chores_week') shouldAward = params.completedThisWeek >= a.threshold
    } else if (a.trigger_type === 'coin_total') {
      shouldAward = params.coinBalance >= a.threshold
    }
    if (shouldAward) toAward.push(a)
  }

  const newlyEarned: string[] = []
  for (const a of toAward) {
    const { error } = await supabase.from('player_achievements').insert({
      user_id: params.userId,
      achievement_id: a.id,
    })
    if (!error) newlyEarned.push(a.key)
  }

  return newlyEarned
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/lib/__tests__/checkAchievements.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/lib/checkAchievements.ts src/lib/__tests__/checkAchievements.test.ts && git commit -m "feat: add checkAndAwardAchievements utility for chore_count and coin_total triggers"
```

---

## Task 4: `useActivityFeed` Hook

**Files:**
- Create: `src/hooks/useActivityFeed.ts`
- Create: `src/hooks/__tests__/useActivityFeed.test.ts`

Fetches the 20 most recent achievement events for all family members (across all players). Used by the activity strip on the player dashboard.

- [ ] **Step 1: Write the failing test**

Write this exact content to `src/hooks/__tests__/useActivityFeed.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
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
    const { result } = renderHook(() => useActivityFeed())
    expect(result.current.loading).toBe(true)
    expect(result.current.items).toEqual([])
  })

  it('returns mapped activity items', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeRow], error: null }))
    const { result } = renderHook(() => useActivityFeed())
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
    const { result } = renderHook(() => useActivityFeed())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאה')
    expect(result.current.items).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/hooks/__tests__/useActivityFeed.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

Write this exact content to `src/hooks/useActivityFeed.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

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
}

export function useActivityFeed(): UseActivityFeedResult {
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
      setItems((data ?? []).map((row: Record<string, unknown>) => {
        const achievement = row.achievements as { icon: string; title_he: string }
        const profile = row.profiles as { name: string; avatar_url: string | null }
        return {
          id: row.id as string,
          profileName: profile.name,
          profileAvatar: profile.avatar_url,
          achievementIcon: achievement.icon,
          achievementTitle: achievement.title_he,
          earnedAt: row.earned_at as string,
        }
      }))
    }
    setLoading(false)
  // supabase is a stable singleton — no external dependencies needed
  }, [])

  useEffect(() => { fetchFeed() }, [fetchFeed])

  return { items, loading, error }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/hooks/__tests__/useActivityFeed.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/hooks/useActivityFeed.ts src/hooks/__tests__/useActivityFeed.test.ts && git commit -m "feat: add useActivityFeed hook for recent family achievement events"
```

---

## Task 5: Player AchievementsPage

**Files:**
- Create: `src/pages/player/achievements/AchievementsPage.tsx`
- Create: `src/pages/player/achievements/__tests__/AchievementsPage.test.tsx`

Grid of all 7 achievement cards: earned ones show icon + title + earned date in full color; unearned show grayed out with "🔒 לא הושג עדיין".

- [ ] **Step 1: Write the failing tests**

Write this exact content to `src/pages/player/achievements/__tests__/AchievementsPage.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { AchievementWithStatus } from '../../../../hooks/useAchievements'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useAchievements', () => ({
  useAchievements: vi.fn(() => ({
    achievements: [],
    earnedIds: new Set(),
    totalCompletedAllTime: 0,
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', name: 'דנה' } }),
}))

import { useAchievements } from '../../../../hooks/useAchievements'
import AchievementsPage from '../AchievementsPage'

const mockUseAchievements = vi.mocked(useAchievements)

const earnedAchievement: AchievementWithStatus = {
  id: 'ach1',
  key: 'first_chore',
  title_he: 'משימה ראשונה',
  description_he: 'השלמת את המשימה הראשונה שלך!',
  icon: '🏆',
  trigger_type: 'chore_count',
  threshold: 1,
  created_at: '2026-04-01T00:00:00Z',
  earned_at: '2026-04-05T10:00:00Z',
  player_achievement_id: 'pa1',
}

const lockedAchievement: AchievementWithStatus = {
  id: 'ach2',
  key: 'five_chores_week',
  title_he: '5 משימות בשבוע',
  description_he: 'השלמת 5 משימות בשבוע אחד',
  icon: '🔥',
  trigger_type: 'chore_count',
  threshold: 5,
  created_at: '2026-04-01T00:00:00Z',
  earned_at: null,
  player_achievement_id: null,
}

function renderPage() {
  return render(<MemoryRouter><AchievementsPage /></MemoryRouter>)
}

describe('AchievementsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading state', () => {
    mockUseAchievements.mockReturnValue({
      achievements: [], earnedIds: new Set(), totalCompletedAllTime: 0,
      loading: true, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows error state', () => {
    mockUseAchievements.mockReturnValue({
      achievements: [], earnedIds: new Set(), totalCompletedAllTime: 0,
      loading: false, error: 'שגיאה', refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאה')
  })

  it('shows earned achievement with icon, title, and earned date', () => {
    mockUseAchievements.mockReturnValue({
      achievements: [earnedAchievement], earnedIds: new Set(['ach1']),
      totalCompletedAllTime: 1, loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('משימה ראשונה')).toBeInTheDocument()
    expect(screen.getByText('🏆')).toBeInTheDocument()
    // earned_at formatted as Hebrew locale date
    expect(screen.getByText(/05\.04\.2026|5.4.2026/)).toBeInTheDocument()
  })

  it('shows locked achievement with lock indicator', () => {
    mockUseAchievements.mockReturnValue({
      achievements: [lockedAchievement], earnedIds: new Set(),
      totalCompletedAllTime: 0, loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('5 משימות בשבוע')).toBeInTheDocument()
    expect(screen.getByText('🔒 לא הושג עדיין')).toBeInTheDocument()
  })

  it('shows earned count summary', () => {
    mockUseAchievements.mockReturnValue({
      achievements: [earnedAchievement, lockedAchievement], earnedIds: new Set(['ach1']),
      totalCompletedAllTime: 1, loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText(/1.*2/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/pages/player/achievements/__tests__/AchievementsPage.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the page**

Write this exact content to `src/pages/player/achievements/AchievementsPage.tsx`:

```typescript
import { useAuth } from '../../../contexts/AuthContext'
import { useAchievements } from '../../../hooks/useAchievements'
import { Card, CardContent } from '../../../components/ui/card'

export default function AchievementsPage() {
  const { profile } = useAuth()
  const { achievements, earnedIds, loading, error } = useAchievements(profile?.id)

  const earnedCount = earnedIds.size
  const totalCount = achievements.length

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">הישגים</h1>
        {totalCount > 0 && (
          <span className="text-sm text-muted-foreground">{earnedCount} מתוך {totalCount}</span>
        )}
      </div>

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {achievements.map(a => {
            const isEarned = a.earned_at !== null
            return (
              <Card key={a.id} className={isEarned ? '' : 'opacity-50'}>
                <CardContent className="py-3 flex items-start gap-3">
                  <span className="text-3xl">{a.icon}</span>
                  <div className="space-y-1 flex-1">
                    <p className="font-semibold text-sm">{a.title_he}</p>
                    <p className="text-xs text-muted-foreground">{a.description_he}</p>
                    {isEarned ? (
                      <p className="text-xs text-green-600">
                        הושג ב‑{new Date(a.earned_at!).toLocaleDateString('he-IL')}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">🔒 לא הושג עדיין</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/pages/player/achievements/__tests__/AchievementsPage.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/pages/player/achievements/AchievementsPage.tsx src/pages/player/achievements/__tests__/AchievementsPage.test.tsx && git commit -m "feat: add player achievements page showing earned vs locked"
```

---

## Task 6: PlayerDashboard Integration (Achievement Check + Activity Feed)

**Files:**
- Modify: `src/pages/player/PlayerDashboard.tsx`
- Modify: `src/pages/player/__tests__/PlayerDashboard.test.tsx`

Add two behaviors to the player dashboard:
1. After data loads, check + award achievements and show toast for newly earned ones.
2. Show a scrollable activity strip of recent family achievement events above the assignment list.

- [ ] **Step 1: Write the new failing tests**

The existing tests mock `useChoreAssignments` and `useChores`. Add mocks for the new dependencies at the top of the existing test file `src/pages/player/__tests__/PlayerDashboard.test.tsx`.

Read the current test file first, then add these items:

**Add at the top** (after existing `vi.mock` calls, before the imports):
```typescript
vi.mock('../../../hooks/useAchievements', () => ({
  useAchievements: vi.fn(() => ({
    achievements: [], earnedIds: new Set(), totalCompletedAllTime: 0,
    loading: false, error: null, refetch: vi.fn(),
  })),
}))
vi.mock('../../../hooks/useActivityFeed', () => ({
  useActivityFeed: vi.fn(() => ({ items: [], loading: false, error: null })),
}))
vi.mock('../../../lib/checkAchievements', () => ({
  checkAndAwardAchievements: vi.fn().mockResolvedValue([]),
}))
```

**Add these imports** (after existing imports):
```typescript
import { useAchievements } from '../../../hooks/useAchievements'
import { useActivityFeed } from '../../../hooks/useActivityFeed'
import { checkAndAwardAchievements } from '../../../lib/checkAchievements'
const mockUseAchievements = vi.mocked(useAchievements)
const mockUseActivityFeed = vi.mocked(useActivityFeed)
const mockCheckAndAward = vi.mocked(checkAndAwardAchievements)
```

**Add these tests** to the `describe('PlayerDashboard')` block:
```typescript
it('shows activity feed item when present', () => {
  mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
  mockUseActivityFeed.mockReturnValue({
    items: [{
      id: 'pa1',
      profileName: 'דנה',
      profileAvatar: null,
      achievementIcon: '🏆',
      achievementTitle: 'משימה ראשונה',
      earnedAt: '2026-04-05T10:00:00Z',
    }],
    loading: false,
    error: null,
  })
  renderDashboard()
  expect(screen.getByText('🏆')).toBeInTheDocument()
  expect(screen.getByText('דנה')).toBeInTheDocument()
})

it('calls checkAndAwardAchievements when all data loaded', async () => {
  mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
  renderDashboard()
  await waitFor(() => expect(mockCheckAndAward).toHaveBeenCalled())
})
```

Also add `waitFor` to the import from `@testing-library/react` if not already there.

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/pages/player/__tests__/PlayerDashboard.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: new tests FAIL, existing tests PASS.

- [ ] **Step 3: Update `src/pages/player/PlayerDashboard.tsx`**

Write this exact content:

```typescript
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useChoreAssignments } from '../../hooks/useChoreAssignments'
import { useChores } from '../../hooks/useChores'
import { useAchievements } from '../../hooks/useAchievements'
import { useActivityFeed } from '../../hooks/useActivityFeed'
import { checkAndAwardAchievements } from '../../lib/checkAchievements'
import { useToast } from '../../hooks/use-toast'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'
import type { AssignmentStatus } from '../../types/database'

const statusLabel: Record<AssignmentStatus, string> = {
  pending: 'ממתין',
  in_progress: 'בביצוע',
  completed: 'הושלם',
  overdue: 'באיחור',
  failed: 'נכשל',
}

const statusVariant: Record<AssignmentStatus, 'default' | 'secondary' | 'destructive'> = {
  pending: 'secondary',
  in_progress: 'default',
  completed: 'secondary',
  overdue: 'destructive',
  failed: 'destructive',
}

export default function PlayerDashboard() {
  const { profile } = useAuth()
  const { assignments, loading } = useChoreAssignments(profile?.id)
  const { chores } = useChores()
  const { achievements, earnedIds, totalCompletedAllTime, loading: achievementsLoading, refetch: achievementsRefetch } = useAchievements(profile?.id)
  const { items: feedItems } = useActivityFeed()
  const { toast } = useToast()

  function choreTitle(choreId: string): string {
    return chores.find(c => c.id === choreId)?.title ?? 'משימה'
  }

  function choreCoins(choreId: string): number {
    return chores.find(c => c.id === choreId)?.coin_value ?? 0
  }

  useEffect(() => {
    if (!profile?.family_id || loading || achievementsLoading) return
    const completedThisWeek = assignments.filter(a => a.status === 'completed').length
    checkAndAwardAchievements({
      userId: profile.id,
      familyId: profile.family_id,
      coinBalance: profile.coin_balance,
      completedThisWeek,
      totalCompletedAllTime,
      earnedIds,
      achievements,
    }).then(newlyEarned => {
      if (newlyEarned.length > 0) {
        newlyEarned.forEach(key => {
          const a = achievements.find(x => x.key === key)
          if (a) toast({ title: '🏆 הישג חדש!', description: `${a.icon} ${a.title_he}` })
        })
        achievementsRefetch()
      }
    })
  }, [profile, loading, assignments, achievementsLoading, achievements, earnedIds, totalCompletedAllTime])

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">המשימות שלי</h1>
        <Button asChild>
          <Link to="/player/pool">בחר משימה</Link>
        </Button>
      </div>

      {/* Activity feed strip */}
      {feedItems.length > 0 && (
        <div className="overflow-x-auto">
          <div className="flex gap-2 pb-1" style={{ width: 'max-content' }}>
            {feedItems.map(item => (
              <div key={item.id} className="flex items-center gap-1 bg-muted rounded-full px-3 py-1 text-xs whitespace-nowrap">
                <span>{item.achievementIcon}</span>
                <span className="font-medium">{item.profileName}</span>
                <span className="text-muted-foreground">{item.achievementTitle}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : assignments.length === 0 ? (
        <p className="text-muted-foreground">אין משימות השבוע. לחץ על "בחר משימה" להוסיף.</p>
      ) : (
        <div className="space-y-3">
          {assignments.map(a => (
            <Card key={a.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{choreTitle(a.chore_id)}</p>
                  <p className="text-sm text-muted-foreground">{choreCoins(a.chore_id)} מטבעות</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant[a.status]}>
                    {statusLabel[a.status]}
                  </Badge>
                  {(a.status === 'pending' || a.status === 'in_progress') && (
                    <Button size="sm" asChild>
                      <Link to={`/player/chores/${a.id}/complete`}>סיימתי</Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run all PlayerDashboard tests**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/pages/player/__tests__/PlayerDashboard.test.tsx --reporter=verbose 2>&1 | tail -15
```

Expected: all tests PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/pages/player/PlayerDashboard.tsx src/pages/player/__tests__/PlayerDashboard.test.tsx && git commit -m "feat: add achievement checking and activity feed to player dashboard"
```

---

## Task 7: Routes + Nav + Realtime Toast in PlayerLayout

**Files:**
- Modify: `src/router.tsx`
- Modify: `src/components/layout/PlayerLayout.tsx`

Add the achievements route, "הישגים" nav link, and a Supabase Realtime subscription that shows a toast when any OTHER family member earns an achievement.

- [ ] **Step 1: Add route to `src/router.tsx`**

Read the file first. Add this import near the other player page imports:
```typescript
import AchievementsPage from './pages/player/achievements/AchievementsPage'
```

In the `/player` children array, add after `{ path: 'feedback', element: <FeedbackPage /> }`:
```typescript
{ path: 'achievements', element: <AchievementsPage /> },
```

- [ ] **Step 2: Update `src/components/layout/PlayerLayout.tsx`**

Read the file first. Then write the complete updated file:

```typescript
import { useEffect } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/use-toast'
import { Button } from '../ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'

export default function PlayerLayout() {
  const { profile, signOut } = useAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (!profile?.id) return

    const channel = supabase
      .channel('achievement-announcements')
      .on(
        'postgres_changes' as const,
        { event: 'INSERT', schema: 'public', table: 'player_achievements' },
        async (payload: { new: { user_id: string; achievement_id: string } }) => {
          // Own achievements are already toasted by checkAndAwardAchievements in PlayerDashboard
          if (payload.new.user_id === profile.id) return

          const { data: achievement } = await supabase
            .from('achievements')
            .select('icon, title_he')
            .eq('id', payload.new.achievement_id)
            .single()

          const { data: achiever } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', payload.new.user_id)
            .single()

          if (achievement && achiever) {
            toast({
              title: `${achievement.icon} הישג משפחתי!`,
              description: `${achiever.name}: ${achievement.title_he}`,
            })
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [profile?.id])

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
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
        </div>
        <nav className="hidden md:flex items-center gap-2">
          <NavLink
            to="/player"
            end
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            הדשבורד שלי
          </NavLink>
          <NavLink
            to="/player/pool"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            בריכה
          </NavLink>
          <NavLink
            to="/player/store"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            החנות
          </NavLink>
          <NavLink
            to="/player/calendar"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            לוח שבועי
          </NavLink>
          <NavLink
            to="/player/feedback"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            משוב
          </NavLink>
          <NavLink
            to="/player/achievements"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            הישגים
          </NavLink>
        </nav>
        <Button variant="outline" size="sm" onClick={signOut}>
          יציאה
        </Button>
      </header>
      <main className="p-4 max-w-4xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Run all tests**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all tests pass (157 + 5 + 6 + 3 + 5 + 2 = 178 or more).

- [ ] **Step 4: TypeScript check**

```bash
cd D:/Claude_Projects/family-chores && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/router.tsx src/components/layout/PlayerLayout.tsx && git commit -m "feat: add achievements route, nav link, and Realtime family announcement toast"
```

---

## Self-Review

**1. Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| Achievements evaluated when events occur | Task 6 — PlayerDashboard checks on load/data change |
| 🏆 משימה ראשונה (first chore) | Task 3 — `first_chore` check via `totalCompletedAllTime` |
| 🔥 5 משימות בשבוע | Task 3 — `five_chores_week` check via `completedThisWeek` |
| 💰 100 מטבעות | Task 3 — `hundred_coins` check via `coinBalance` |
| 🤝 עסקה ראשונה | Locked (trade feature not built) — shown as locked on AchievementsPage |
| ⭐ שדרוג אמון | Locked (trust level management not built) |
| 👑 מוביל השבוע | Locked (no cross-family comparison built) |
| 🗓️ שבוע מושלם | Locked (streak tracking not built) |
| Toast pop-up when earned (self) | Task 6 — `checkAndAwardAchievements` → `toast()` in PlayerDashboard |
| Toast pop-up for all online family members | Task 7 — Supabase Realtime in PlayerLayout |
| Activity Feed on dashboard | Task 6 — `useActivityFeed` strip in PlayerDashboard |

**Note:** Trade, trust level, weekly top, and streak achievements are displayed as locked cards. They will become awardable when those features are added (just extend the `if` block in `checkAndAwardAchievements`).

**2. Placeholder scan:** None found — all steps contain complete code.

**3. Type consistency:**
- `AchievementWithStatus` defined in Task 2 (`useAchievements.ts`), imported in Task 3 (`checkAchievements.ts`), Task 5 (`AchievementsPage`), and Task 6 (`PlayerDashboard`) ✅
- `CheckAchievementsParams` defined in Task 3, used in Task 6 ✅
- `ActivityItem` defined in Task 4 (`useActivityFeed.ts`), used in Task 6 ✅
- Route path `'/player/achievements'` consistent across Tasks 5 and 7 ✅
- `mockChannel`/`mockRemoveChannel` added in Task 1, available for all tests in Tasks 7+ ✅
