# Admin Dashboard Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Admin Dashboard with missing stat cards and a leaderboard, add a Players Management page for trust level promotion/demotion, and add manual coin bonus grants.

**Architecture:** One new SQL migration adds two RPCs (`grant_manual_bonus`, `set_trust_level`). One new hook (`useAdminDashboardStats`) fetches weekly coin totals + active trade count in parallel. `AdminDashboard` grows from 2 cards to 5 cards + a leaderboard. A new `PlayersPage` at `/admin/players` lists all players with inline trust-level controls and a bonus dialog. `useFamilyMembers` gains a `refetch` callback.

**Tech Stack:** React 18, TypeScript, Tailwind, shadcn/ui (Card, Button, Avatar, Badge, Dialog, Input), Supabase JS v2 (RPC + direct queries), Vitest + React Testing Library

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/011_admin_rpcs.sql` | Create | `grant_manual_bonus` and `set_trust_level` RPCs |
| `src/hooks/useAdminDashboardStats.ts` | Create | Weekly coins total, active trades count, leaderboard |
| `src/hooks/__tests__/useAdminDashboardStats.test.ts` | Create | 4 hook tests |
| `src/pages/admin/AdminDashboard.tsx` | Modify | Add pending completions card, active trades card, weekly coins card, leaderboard |
| `src/pages/admin/__tests__/AdminDashboard.test.tsx` | Create | 5 page tests |
| `src/hooks/useFamilyMembers.ts` | Modify | Add `refetch` callback following established hook pattern |
| `src/pages/admin/players/PlayersPage.tsx` | Create | Trust level +/− controls and manual bonus dialog per player |
| `src/pages/admin/players/__tests__/PlayersPage.test.tsx` | Create | 5 page tests |
| `src/router.tsx` | Modify | Add `/admin/players` route |
| `src/components/layout/AdminLayout.tsx` | Modify | Add "שחקנים" NavLink |

---

## Context for Implementers

### Supabase mock file locations
- From `src/hooks/__tests__/`: `'../../test/mocks/supabase'`
- From `src/pages/admin/__tests__/`: `'../../../test/mocks/supabase'` *(only needed if a page calls supabase directly — AdminDashboard does not)*

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

### `getCurrentWeekStart()` location
`src/lib/weekStart.ts` — returns ISO date string `'YYYY-MM-DD'` for the Sunday of the current week.

### Existing types (from `src/types/database.ts`)
```typescript
export interface Profile {
  id: string; family_id: string | null; name: string; avatar_url: string | null
  role: UserRole; trust_level: number; coin_balance: number
  created_at: string; updated_at: string
}
```

### Running all tests
```bash
cd D:/Claude_Projects/family-chores && npx vitest run --reporter=verbose 2>&1 | tail -10
```

---

## Task 1: SQL Migration — Admin RPCs

**File:** Create `supabase/migrations/011_admin_rpcs.sql`

No TDD for SQL migrations. Write the file, then commit.

- [ ] **Step 1: Write the migration**

Write this exact content to `supabase/migrations/011_admin_rpcs.sql`:

```sql
-- grant_manual_bonus: atomically insert a coin_transaction and update coin_balance
create or replace function grant_manual_bonus(
  p_target_user_id uuid,
  p_amount         integer,
  p_family_id      uuid,
  p_admin_id       uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if not exists (
    select 1 from profiles where id = p_admin_id and role = 'admin'
  ) then
    raise exception 'caller is not an admin';
  end if;
  insert into coin_transactions(user_id, family_id, amount, reason, related_entity_id)
  values (p_target_user_id, p_family_id, p_amount, 'manual_bonus', null);
  update profiles
  set coin_balance = coin_balance + p_amount, updated_at = now()
  where id = p_target_user_id;
end;
$$;

-- set_trust_level: update a player's trust_level (1–5)
create or replace function set_trust_level(
  p_target_user_id uuid,
  p_new_level      integer,
  p_admin_id       uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_new_level < 1 or p_new_level > 5 then
    raise exception 'trust level must be between 1 and 5';
  end if;
  if not exists (
    select 1 from profiles where id = p_admin_id and role = 'admin'
  ) then
    raise exception 'caller is not an admin';
  end if;
  update profiles
  set trust_level = p_new_level, updated_at = now()
  where id = p_target_user_id;
end;
$$;
```

- [ ] **Step 2: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add supabase/migrations/011_admin_rpcs.sql && git commit -m "feat: add grant_manual_bonus and set_trust_level RPCs"
```

---

## Task 2: `useAdminDashboardStats` Hook

**Files:**
- Create: `src/hooks/useAdminDashboardStats.ts`
- Create: `src/hooks/__tests__/useAdminDashboardStats.test.ts`

- [ ] **Step 1: Write the failing tests**

Write this exact content to `src/hooks/__tests__/useAdminDashboardStats.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useAdminDashboardStats } from '../useAdminDashboardStats'

function setupMocks(
  txRows: object[],
  tradeRows: object[],
  err1: null | { message: string } = null,
  err2: null | { message: string } = null,
) {
  mockFrom
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      gt: vi.fn().mockResolvedValue({ data: err1 ? null : txRows, error: err1 }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: err2 ? null : tradeRows, error: err2 }),
    })
}

const tx1 = { amount: 30, user_id: 'u1', profiles: { name: 'אבי', avatar_url: null } }
const tx2 = { amount: 10, user_id: 'u1', profiles: { name: 'אבי', avatar_url: null } }
const tx3 = { amount: 20, user_id: 'u2', profiles: { name: 'דנה', avatar_url: null } }

describe('useAdminDashboardStats', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnValue(new Promise(() => {})),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnValue(new Promise(() => {})),
      })
    const { result } = renderHook(() => useAdminDashboardStats())
    expect(result.current.loading).toBe(true)
  })

  it('computes weekly total, active trades, and sorted leaderboard', async () => {
    setupMocks([tx1, tx2, tx3], [{ id: 't1' }, { id: 't2' }])
    const { result } = renderHook(() => useAdminDashboardStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.totalCoinsThisWeek).toBe(60)   // 30+10+20
    expect(result.current.activeTradesCount).toBe(2)
    expect(result.current.leaderboard).toHaveLength(2)
    // u1 earned 40 (30+10), u2 earned 20 → sorted descending
    expect(result.current.leaderboard[0].userId).toBe('u1')
    expect(result.current.leaderboard[0].weeklyEarned).toBe(40)
    expect(result.current.leaderboard[1].userId).toBe('u2')
    expect(result.current.leaderboard[1].weeklyEarned).toBe(20)
    expect(result.current.error).toBeNull()
  })

  it('returns zero counts when no transactions or trades', async () => {
    setupMocks([], [])
    const { result } = renderHook(() => useAdminDashboardStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.totalCoinsThisWeek).toBe(0)
    expect(result.current.activeTradesCount).toBe(0)
    expect(result.current.leaderboard).toEqual([])
  })

  it('sets error when query fails', async () => {
    setupMocks([], [], { message: 'DB error' })
    const { result } = renderHook(() => useAdminDashboardStats())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/hooks/__tests__/useAdminDashboardStats.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

Write this exact content to `src/hooks/useAdminDashboardStats.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentWeekStart } from '../lib/weekStart'

export interface LeaderboardEntry {
  userId: string
  name: string
  avatarUrl: string | null
  weeklyEarned: number
}

export interface UseAdminDashboardStatsResult {
  leaderboard: LeaderboardEntry[]
  totalCoinsThisWeek: number
  activeTradesCount: number
  loading: boolean
  error: string | null
}

type TxRow = {
  amount: number
  user_id: string
  profiles: { name: string; avatar_url: string | null }
}

export function useAdminDashboardStats(): UseAdminDashboardStatsResult {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [totalCoinsThisWeek, setTotalCoinsThisWeek] = useState(0)
  const [activeTradesCount, setActiveTradesCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    const weekStart = getCurrentWeekStart()

    const [
      { data: txData, error: txErr },
      { data: tradeData, error: tradeErr },
    ] = await Promise.all([
      supabase
        .from('coin_transactions')
        .select('amount, user_id, profiles!user_id(name, avatar_url)')
        .gte('created_at', weekStart)
        .gt('amount', 0),
      supabase
        .from('trade_offers')
        .select('id')
        .eq('status', 'pending'),
    ])

    if (!mountedRef.current) return

    if (txErr || tradeErr) {
      setError((txErr ?? tradeErr)?.message ?? 'Unknown error')
      setLoading(false)
      return
    }

    const rows = (txData ?? []) as unknown as TxRow[]
    const totals = new Map<string, LeaderboardEntry>()
    let weekTotal = 0

    for (const row of rows) {
      weekTotal += row.amount
      const entry = totals.get(row.user_id) ?? {
        userId: row.user_id,
        name: row.profiles?.name ?? '?',
        avatarUrl: row.profiles?.avatar_url ?? null,
        weeklyEarned: 0,
      }
      entry.weeklyEarned += row.amount
      totals.set(row.user_id, entry)
    }

    setLeaderboard([...totals.values()].sort((a, b) => b.weeklyEarned - a.weeklyEarned))
    setTotalCoinsThisWeek(weekTotal)
    setActiveTradesCount((tradeData ?? []).length)
    setLoading(false)
  // supabase and getCurrentWeekStart are stable singletons
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  return { leaderboard, totalCoinsThisWeek, activeTradesCount, loading, error }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/hooks/__tests__/useAdminDashboardStats.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/hooks/useAdminDashboardStats.ts src/hooks/__tests__/useAdminDashboardStats.test.ts && git commit -m "feat: add useAdminDashboardStats hook for weekly coins, active trades, and leaderboard"
```

---

## Task 3: `AdminDashboard` Update

**Files:**
- Modify: `src/pages/admin/AdminDashboard.tsx`
- Create: `src/pages/admin/__tests__/AdminDashboard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Write this exact content to `src/pages/admin/__tests__/AdminDashboard.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../hooks/usePendingRedemptions', () => ({
  usePendingRedemptions: vi.fn(() => ({ redemptions: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../hooks/usePendingCompletions', () => ({
  usePendingCompletions: vi.fn(() => ({ completions: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../hooks/useAdminDashboardStats', () => ({
  useAdminDashboardStats: vi.fn(() => ({
    leaderboard: [], totalCoinsThisWeek: 0, activeTradesCount: 0, loading: false, error: null,
  })),
}))

import { useChores } from '../../../hooks/useChores'
import { usePendingRedemptions } from '../../../hooks/usePendingRedemptions'
import { usePendingCompletions } from '../../../hooks/usePendingCompletions'
import { useAdminDashboardStats } from '../../../hooks/useAdminDashboardStats'
import AdminDashboard from '../AdminDashboard'

const mockUseChores = vi.mocked(useChores)
const mockUsePendingRedemptions = vi.mocked(usePendingRedemptions)
const mockUsePendingCompletions = vi.mocked(usePendingCompletions)
const mockUseAdminDashboardStats = vi.mocked(useAdminDashboardStats)

function renderPage() {
  return render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
}

describe('AdminDashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows pending proposals count', () => {
    mockUseChores.mockReturnValue({
      chores: [
        { id: 'c1', status: 'pending_approval' } as any,
        { id: 'c2', status: 'active' } as any,
      ],
      loading: false, error: null, refetch: vi.fn(),
    })
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: false, error: null, refetch: vi.fn() })
    mockUseAdminDashboardStats.mockReturnValue({ leaderboard: [], totalCoinsThisWeek: 0, activeTradesCount: 0, loading: false, error: null })
    renderPage()
    expect(screen.getByText('הצעות ממתינות לאישור')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows pending completions count', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingCompletions.mockReturnValue({
      completions: [{ id: 'cp1' } as any, { id: 'cp2' } as any, { id: 'cp3' } as any],
      loading: false, error: null, refetch: vi.fn(),
    })
    mockUseAdminDashboardStats.mockReturnValue({ leaderboard: [], totalCoinsThisWeek: 0, activeTradesCount: 0, loading: false, error: null })
    renderPage()
    expect(screen.getByText('הגשות ממתינות לאישור')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows active trades count', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: false, error: null, refetch: vi.fn() })
    mockUseAdminDashboardStats.mockReturnValue({ leaderboard: [], totalCoinsThisWeek: 0, activeTradesCount: 7, loading: false, error: null })
    renderPage()
    expect(screen.getByText('עסקאות פעילות')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('shows weekly coins total and leaderboard entries', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: false, error: null, refetch: vi.fn() })
    mockUseAdminDashboardStats.mockReturnValue({
      leaderboard: [
        { userId: 'u1', name: 'אבי', avatarUrl: null, weeklyEarned: 90 },
        { userId: 'u2', name: 'דנה', avatarUrl: null, weeklyEarned: 60 },
      ],
      totalCoinsThisWeek: 150,
      activeTradesCount: 0,
      loading: false, error: null,
    })
    renderPage()
    expect(screen.getByText(/150/)).toBeInTheDocument()
    expect(screen.getByText('אבי')).toBeInTheDocument()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText(/90/)).toBeInTheDocument()
  })

  it('shows dashes while stats are loading', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: false, error: null, refetch: vi.fn() })
    mockUseAdminDashboardStats.mockReturnValue({ leaderboard: [], totalCoinsThisWeek: 0, activeTradesCount: 0, loading: true, error: null })
    renderPage()
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/pages/admin/__tests__/AdminDashboard.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL — module/component mismatch.

- [ ] **Step 3: Rewrite `AdminDashboard.tsx`**

Write this exact content to `src/pages/admin/AdminDashboard.tsx`:

```typescript
import { Link } from 'react-router-dom'
import { useChores } from '../../hooks/useChores'
import { usePendingRedemptions } from '../../hooks/usePendingRedemptions'
import { usePendingCompletions } from '../../hooks/usePendingCompletions'
import { useAdminDashboardStats } from '../../hooks/useAdminDashboardStats'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'

export default function AdminDashboard() {
  const { chores } = useChores()
  const { redemptions } = usePendingRedemptions()
  const { completions } = usePendingCompletions()
  const { leaderboard, totalCoinsThisWeek, activeTradesCount, loading: statsLoading } = useAdminDashboardStats()

  const pendingProposalsCount = chores.filter(c => c.status === 'pending_approval').length
  const pendingRedemptionsCount = redemptions.length
  const pendingCompletionsCount = completions.length

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">דשבורד מנהל</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">הצעות ממתינות לאישור</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingProposalsCount}</p>
            <Button variant="link" className="px-0 mt-1 h-auto text-sm" asChild>
              <Link to="/admin/chores">לניהול משימות ←</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">בקשות מימוש ממתינות</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingRedemptionsCount}</p>
            <Button variant="link" className="px-0 mt-1 h-auto text-sm" asChild>
              <Link to="/admin/redemptions">לבקשות מימוש ←</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">הגשות ממתינות לאישור</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingCompletionsCount}</p>
            <Button variant="link" className="px-0 mt-1 h-auto text-sm" asChild>
              <Link to="/admin/completions">לאישור הגשות ←</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">עסקאות פעילות</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{statsLoading ? '—' : activeTradesCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">מטבעות הושגו השבוע (כל המשפחה)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-green-600">{statsLoading ? '—' : `🪙 ${totalCoinsThisWeek}`}</p>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-3">טבלת המובילים השבועית</h2>
        {statsLoading ? (
          <p className="text-muted-foreground text-sm">טוען...</p>
        ) : leaderboard.length === 0 ? (
          <p className="text-muted-foreground text-sm">אין נתונים לשבוע זה.</p>
        ) : (
          <div className="space-y-2">
            {leaderboard.map((entry, idx) => (
              <div key={entry.userId} className="flex items-center gap-3 py-2 border-b last:border-0">
                <span className="text-muted-foreground text-sm w-5 text-center">{idx + 1}</span>
                <Avatar className="h-8 w-8">
                  <AvatarImage src={entry.avatarUrl ?? undefined} />
                  <AvatarFallback>{entry.name[0]}</AvatarFallback>
                </Avatar>
                <span className="flex-1 text-sm font-medium">{entry.name}</span>
                <span className="text-sm font-semibold text-green-600">🪙 {entry.weeklyEarned}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/pages/admin/__tests__/AdminDashboard.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/pages/admin/AdminDashboard.tsx src/pages/admin/__tests__/AdminDashboard.test.tsx && git commit -m "feat: expand admin dashboard with completions card, active trades card, weekly coins, and leaderboard"
```

---

## Task 4: `useFamilyMembers` Refetch + `PlayersPage`

**Files:**
- Modify: `src/hooks/useFamilyMembers.ts`
- Create: `src/pages/admin/players/PlayersPage.tsx`
- Create: `src/pages/admin/players/__tests__/PlayersPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Write this exact content to `src/pages/admin/players/__tests__/PlayersPage.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { Profile } from '../../../../types/database'

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'admin1', family_id: 'f1', role: 'admin', name: 'Admin',
      avatar_url: null, coin_balance: 0, trust_level: 5,
      created_at: '', updated_at: '',
    },
  }),
}))

const mockRefetch = vi.fn()
vi.mock('../../../../hooks/useFamilyMembers', () => ({
  useFamilyMembers: vi.fn(() => ({
    members: [], loading: false, error: null, refetch: mockRefetch,
  })),
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}))

import { useFamilyMembers } from '../../../../hooks/useFamilyMembers'
import { supabase } from '../../../../lib/supabase'
import PlayersPage from '../PlayersPage'

const mockUseFamilyMembers = vi.mocked(useFamilyMembers)
const mockRpc = vi.mocked(supabase.rpc)

const player1: Profile = {
  id: 'p1', family_id: 'f1', name: 'דנה', avatar_url: null,
  role: 'player', trust_level: 2, coin_balance: 50,
  created_at: '', updated_at: '',
}
const player2: Profile = {
  id: 'p2', family_id: 'f1', name: 'אבי', avatar_url: null,
  role: 'player', trust_level: 5, coin_balance: 100,
  created_at: '', updated_at: '',
}

function renderPage() {
  return render(<MemoryRouter><PlayersPage /></MemoryRouter>)
}

describe('PlayersPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows player names, coin balances, and trust level badges', () => {
    mockUseFamilyMembers.mockReturnValue({ members: [player1, player2], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText('אבי')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('calls set_trust_level RPC and refetches on promote', async () => {
    mockUseFamilyMembers.mockReturnValue({ members: [player1], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null } as any)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /העלה רמת אמון של דנה/ }))
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('set_trust_level', {
      p_target_user_id: 'p1', p_new_level: 3,
    }))
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('disables promote button when trust level is already 5', () => {
    mockUseFamilyMembers.mockReturnValue({ members: [player2], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('button', { name: /העלה רמת אמון של אבי/ })).toBeDisabled()
  })

  it('opens bonus dialog, submits grant_manual_bonus RPC, and refetches', async () => {
    mockUseFamilyMembers.mockReturnValue({ members: [player1], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null } as any)
    renderPage()
    fireEvent.click(screen.getByText('מענק בונוס'))
    const input = screen.getByRole('spinbutton', { name: /כמות מטבעות/ })
    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /^מענק$/ }))
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('grant_manual_bonus', {
      p_target_user_id: 'p1', p_amount: 25, p_family_id: 'f1',
    }))
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('shows error message when trust level RPC fails', async () => {
    mockUseFamilyMembers.mockReturnValue({ members: [player1], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'שגיאת הרשאות' } } as any)
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /העלה רמת אמון של דנה/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('שגיאת הרשאות'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/pages/admin/players/__tests__/PlayersPage.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Add `refetch` to `useFamilyMembers`**

Read `src/hooks/useFamilyMembers.ts` (already read — 35 lines). Replace the entire file content with:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

interface UseFamilyMembersResult {
  members: Profile[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFamilyMembers(): UseFamilyMembersResult {
  const [members, setMembers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('name')
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setMembers((data as Profile[]) ?? [])
    }
    setLoading(false)
  // supabase is a stable singleton — no external dependencies needed
  }, [])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  return { members, loading, error, refetch: fetchMembers }
}
```

- [ ] **Step 4: Write `PlayersPage.tsx`**

Write this exact content to `src/pages/admin/players/PlayersPage.tsx`:

```typescript
import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useFamilyMembers } from '../../../hooks/useFamilyMembers'
import { supabase } from '../../../lib/supabase'
import { Card, CardContent } from '../../../components/ui/card'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import type { Profile } from '../../../types/database'

export default function PlayersPage() {
  const { profile: adminProfile } = useAuth()
  const { members, loading, error, refetch } = useFamilyMembers()
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bonusTarget, setBonusTarget] = useState<Profile | null>(null)
  const [bonusAmount, setBonusAmount] = useState('')
  const [bonusSubmitting, setBonusSubmitting] = useState(false)

  const players = members.filter(m => m.role === 'player')

  async function handleTrustChange(target: Profile, delta: -1 | 1) {
    const newLevel = (target.trust_level ?? 1) + delta
    if (newLevel < 1 || newLevel > 5) return
    setActionError(null)
    setBusyId(target.id)
    const { error } = await supabase.rpc('set_trust_level', {
      p_target_user_id: target.id,
      p_new_level: newLevel,
    })
    setBusyId(null)
    if (error) { setActionError(error.message) } else { refetch() }
  }

  async function handleGrantBonus() {
    const amount = parseInt(bonusAmount, 10)
    if (!bonusTarget || !adminProfile || isNaN(amount) || amount <= 0) return
    setBonusSubmitting(true)
    setActionError(null)
    const { error } = await supabase.rpc('grant_manual_bonus', {
      p_target_user_id: bonusTarget.id,
      p_amount: amount,
      p_family_id: adminProfile.family_id!,
    })
    setBonusSubmitting(false)
    if (error) {
      setActionError(error.message)
    } else {
      setBonusTarget(null)
      setBonusAmount('')
      refetch()
    }
  }

  if (loading) return <div role="status" className="text-muted-foreground py-8 text-center">טוען...</div>

  return (
    <div className="space-y-4" dir="rtl">
      <h1 className="text-2xl font-bold">ניהול שחקנים</h1>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      <div className="space-y-3">
        {players.map(player => (
          <Card key={player.id}>
            <CardContent className="py-3 flex flex-wrap items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={player.avatar_url ?? undefined} />
                <AvatarFallback>{player.name[0]}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{player.name}</p>
                <p className="text-xs text-muted-foreground">🪙 {player.coin_balance}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">רמת אמון</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(player.trust_level ?? 1) <= 1 || busyId === player.id}
                  onClick={() => handleTrustChange(player, -1)}
                  aria-label={`הורד רמת אמון של ${player.name}`}
                >
                  −
                </Button>
                <Badge variant="secondary">{player.trust_level}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(player.trust_level ?? 1) >= 5 || busyId === player.id}
                  onClick={() => handleTrustChange(player, 1)}
                  aria-label={`העלה רמת אמון של ${player.name}`}
                >
                  +
                </Button>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { setBonusTarget(player); setBonusAmount('') }}
              >
                מענק בונוס
              </Button>
            </CardContent>
          </Card>
        ))}
        {players.length === 0 && (
          <p className="text-muted-foreground text-sm">אין שחקנים במשפחה.</p>
        )}
      </div>

      <Dialog open={!!bonusTarget} onOpenChange={open => { if (!open) setBonusTarget(null) }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>מענק בונוס ל{bonusTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="number"
              min="1"
              placeholder="מספר מטבעות"
              value={bonusAmount}
              onChange={e => setBonusAmount(e.target.value)}
              aria-label="כמות מטבעות"
            />
            <Button
              className="w-full"
              disabled={bonusSubmitting || !bonusAmount || parseInt(bonusAmount, 10) <= 0}
              onClick={handleGrantBonus}
            >
              {bonusSubmitting ? 'שולח...' : 'מענק'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/pages/admin/players/__tests__/PlayersPage.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: 5 PASS

- [ ] **Step 6: Run all tests to check nothing broke**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all tests pass (no regressions from useFamilyMembers change).

- [ ] **Step 7: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/hooks/useFamilyMembers.ts src/pages/admin/players/PlayersPage.tsx src/pages/admin/players/__tests__/PlayersPage.test.tsx && git commit -m "feat: add players management page with trust level controls and manual bonus grants"
```

---

## Task 5: Route + Nav

**Files:**
- Modify: `src/router.tsx`
- Modify: `src/components/layout/AdminLayout.tsx`

No TDD — routing changes are trivially verified by the full test suite.

- [ ] **Step 1: Add route to `src/router.tsx`**

Read the file first. Add this import near the other admin page imports:

```typescript
import PlayersPage from './pages/admin/players/PlayersPage'
```

In the `/admin` children array, add after `{ path: 'feedback', element: <FeedbackDashboard /> }`:

```typescript
{ path: 'players', element: <PlayersPage /> },
```

- [ ] **Step 2: Add nav link to `src/components/layout/AdminLayout.tsx`**

Read the file first. Add this NavLink after the "משוב" NavLink (before the closing `</nav>`):

```typescript
          <NavLink
            to="/admin/players"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            שחקנים
          </NavLink>
```

- [ ] **Step 3: Run all tests**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: TypeScript check**

```bash
cd D:/Claude_Projects/family-chores && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/router.tsx src/components/layout/AdminLayout.tsx && git commit -m "feat: add players management route and nav link in AdminLayout"
```

---

## Self-Review

**1. Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| Admin Dashboard: pending completions card | Task 3 — 3rd summary card |
| Admin Dashboard: active trades card | Task 3 — 4th summary card |
| Admin Dashboard: total coins this week | Task 3 — wide coin card |
| Admin Dashboard: family leaderboard by weekly coins | Tasks 2 + 3 — `useAdminDashboardStats` + leaderboard section |
| Admin: promote/demote trust levels (§2, §4.2) | Task 4 — `PlayersPage` +/− buttons → `set_trust_level` RPC |
| Admin: grant manual bonus coins (§4.3) | Task 4 — "מענק בונוס" dialog → `grant_manual_bonus` RPC |
| RPC atomicity for coin_balance + coin_transaction | Task 1 — single PL/pgSQL function |

**2. Placeholder scan:** No TBDs, no "implement later". All steps contain complete code. ✅

**3. Type consistency:**
- `LeaderboardEntry` defined in `useAdminDashboardStats.ts` and consumed in `AdminDashboard.tsx` via the hook return type ✅
- `set_trust_level` RPC params in `PlayersPage` match the SQL function signature ✅
- `grant_manual_bonus` RPC params in `PlayersPage` match the SQL function signature ✅
- `useFamilyMembers` now returns `refetch: () => void` — `PlayersPage` destructures it correctly ✅
