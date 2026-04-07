# Profile Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal player profile screen with a fixed header (avatar, name, coins, trust bar) and three tabs: coin transaction history, achievements summary, and a trade placeholder.

**Architecture:** Two new files (hook + page), two modified files (router, layout). `useCoinTransactions` runs two parallel Supabase queries — one for recent display rows, one for accurate lifetime totals. `ProfilePage` manages tab state locally with `useState`. No new DB tables or migrations needed.

**Tech Stack:** React 18, TypeScript, Tailwind, shadcn/ui (Card, Button, Avatar, Badge), Supabase JS v2, Vitest + React Testing Library

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `src/hooks/useCoinTransactions.ts` | Create | Fetch last 20 transactions + compute lifetime totals |
| `src/hooks/__tests__/useCoinTransactions.test.ts` | Create | 4 hook tests |
| `src/pages/player/profile/ProfilePage.tsx` | Create | Tabbed profile page |
| `src/pages/player/profile/__tests__/ProfilePage.test.tsx` | Create | 6 page tests |
| `src/router.tsx` | Modify | Add `/player/profile` route |
| `src/components/layout/PlayerLayout.tsx` | Modify | Avatar → link to profile + "פרופיל" nav link |

---

## Context for Implementers

### Existing Types (from `src/types/database.ts`)

```typescript
export type CoinReason = 'chore_completed' | 'reward_redeemed' | 'trade_transfer' | 'penalty' | 'manual_bonus' | 'refund'

export interface CoinTransaction {
  id: string
  user_id: string
  family_id: string
  amount: number
  reason: CoinReason
  related_entity_id: string | null
  created_at: string
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

### Supabase mock file location

- From `src/hooks/__tests__/`: `'../../test/mocks/supabase'`
- From `src/pages/player/profile/__tests__/`: `'../../../../test/mocks/supabase'`

### Running all tests

```bash
cd D:/Claude_Projects/family-chores && npx vitest run --reporter=verbose 2>&1 | tail -10
```

---

## Task 1: `useCoinTransactions` Hook

**Files:**
- Create: `src/hooks/useCoinTransactions.ts`
- Create: `src/hooks/__tests__/useCoinTransactions.test.ts`

- [ ] **Step 1: Write the failing tests**

Write this exact content to `src/hooks/__tests__/useCoinTransactions.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useCoinTransactions } from '../useCoinTransactions'
import type { CoinTransaction } from '../../types/database'

const fakeTx: CoinTransaction = {
  id: 'tx1',
  user_id: 'u1',
  family_id: 'f1',
  amount: 10,
  reason: 'chore_completed',
  related_entity_id: null,
  created_at: '2026-04-05T10:00:00Z',
}

const negTx: CoinTransaction = {
  id: 'tx2',
  user_id: 'u1',
  family_id: 'f1',
  amount: -5,
  reason: 'reward_redeemed',
  related_entity_id: null,
  created_at: '2026-04-04T10:00:00Z',
}

function setupMocks(
  recentRows: CoinTransaction[],
  allAmounts: { amount: number }[],
  err1: null | { message: string } = null,
  err2: null | { message: string } = null,
) {
  mockFrom
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: err1 ? null : recentRows, error: err1 }),
    })
    .mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: err2 ? null : allAmounts, error: err2 }),
    })
}

describe('useCoinTransactions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnValue(new Promise(() => {})),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnValue(new Promise(() => {})),
      })
    const { result } = renderHook(() => useCoinTransactions('u1'))
    expect(result.current.loading).toBe(true)
    expect(result.current.transactions).toEqual([])
  })

  it('returns transactions and computes totals from all rows', async () => {
    setupMocks([fakeTx, negTx], [{ amount: 10 }, { amount: -5 }, { amount: 20 }])
    const { result } = renderHook(() => useCoinTransactions('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.transactions).toHaveLength(2)
    expect(result.current.totalEarned).toBe(30)   // 10 + 20
    expect(result.current.totalSpent).toBe(5)     // abs(-5)
    expect(result.current.error).toBeNull()
  })

  it('sets error when any query fails', async () => {
    setupMocks([], [], { message: 'DB down' })
    const { result } = renderHook(() => useCoinTransactions('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB down')
  })

  it('returns empty results when userId is undefined', async () => {
    const { result } = renderHook(() => useCoinTransactions(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.transactions).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/hooks/__tests__/useCoinTransactions.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

Write this exact content to `src/hooks/useCoinTransactions.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { CoinTransaction } from '../types/database'

export interface UseCoinTransactionsResult {
  transactions: CoinTransaction[]
  totalEarned: number
  totalSpent: number
  loading: boolean
  error: string | null
}

export function useCoinTransactions(userId: string | undefined): UseCoinTransactionsResult {
  const [transactions, setTransactions] = useState<CoinTransaction[]>([])
  const [totalEarned, setTotalEarned] = useState(0)
  const [totalSpent, setTotalSpent] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchTransactions = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    const [
      { data: recentData, error: err1 },
      { data: allData, error: err2 },
    ] = await Promise.all([
      supabase
        .from('coin_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('coin_transactions')
        .select('amount')
        .eq('user_id', userId),
    ])

    if (!mountedRef.current) return

    if (err1 || err2) {
      setError((err1 ?? err2)?.message ?? 'Unknown error')
      setLoading(false)
      return
    }

    setTransactions((recentData ?? []) as CoinTransaction[])

    const amounts = (allData ?? []) as { amount: number }[]
    setTotalEarned(amounts.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0))
    setTotalSpent(amounts.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0))
    setLoading(false)
  // supabase is a stable singleton — no external dependencies needed
  }, [userId])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  return { transactions, totalEarned, totalSpent, loading, error }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/hooks/__tests__/useCoinTransactions.test.ts --reporter=verbose 2>&1 | tail -10
```

Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/hooks/useCoinTransactions.ts src/hooks/__tests__/useCoinTransactions.test.ts && git commit -m "feat: add useCoinTransactions hook with parallel queries for display and totals"
```

---

## Task 2: `ProfilePage`

**Files:**
- Create: `src/pages/player/profile/ProfilePage.tsx`
- Create: `src/pages/player/profile/__tests__/ProfilePage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Write this exact content to `src/pages/player/profile/__tests__/ProfilePage.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { AchievementWithStatus } from '../../../../hooks/useAchievements'
import type { CoinTransaction } from '../../../../types/database'

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'u1',
      name: 'דנה',
      avatar_url: null,
      coin_balance: 50,
      trust_level: 3,
      family_id: 'f1',
      role: 'player',
      created_at: '',
      updated_at: '',
    },
  }),
}))

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useAchievements', () => ({
  useAchievements: vi.fn(() => ({
    achievements: [] as AchievementWithStatus[],
    earnedIds: new Set(['ach1']),
    totalCompletedAllTime: 1,
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))

vi.mock('../../../../hooks/useCoinTransactions', () => ({
  useCoinTransactions: vi.fn(() => ({
    transactions: [] as CoinTransaction[],
    totalEarned: 100,
    totalSpent: 30,
    loading: false,
    error: null,
  })),
}))

import { useCoinTransactions } from '../../../../hooks/useCoinTransactions'
import ProfilePage from '../ProfilePage'

const mockUseCoinTransactions = vi.mocked(useCoinTransactions)

const fakeTx: CoinTransaction = {
  id: 'tx1',
  user_id: 'u1',
  family_id: 'f1',
  amount: 10,
  reason: 'chore_completed',
  related_entity_id: null,
  created_at: '2026-04-05T10:00:00Z',
}

const negTx: CoinTransaction = {
  id: 'tx2',
  user_id: 'u1',
  family_id: 'f1',
  amount: -5,
  reason: 'reward_redeemed',
  related_entity_id: null,
  created_at: '2026-04-04T10:00:00Z',
}

function renderPage() {
  return render(<MemoryRouter><ProfilePage /></MemoryRouter>)
}

describe('ProfilePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading state', () => {
    mockUseCoinTransactions.mockReturnValue({
      transactions: [], totalEarned: 0, totalSpent: 0, loading: true, error: null,
    })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows player name, coin balance, and trust level bar', () => {
    renderPage()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText(/50/)).toBeInTheDocument()
    expect(screen.getByText(/3.*5|3 \/ 5/)).toBeInTheDocument()
  })

  it('shows coin summary stats on coins tab (default)', () => {
    mockUseCoinTransactions.mockReturnValue({
      transactions: [fakeTx, negTx], totalEarned: 100, totalSpent: 30, loading: false, error: null,
    })
    renderPage()
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('משימה הושלמה')).toBeInTheDocument()
    expect(screen.getByText('פדיון פרס')).toBeInTheDocument()
  })

  it('shows achievements summary when achievements tab clicked', () => {
    fireEvent.click(screen.getByText(/הישגים/))
    expect(screen.getByText(/1.*7|1 מתוך 7/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ראה את כל ההישגים/ })).toBeInTheDocument()
  })

  it('shows locked trade placeholder when trades tab clicked', () => {
    renderPage()
    fireEvent.click(screen.getByText(/מסחר/))
    expect(screen.getByText('שוק ההחלפות')).toBeInTheDocument()
    expect(screen.getByText(/בקרוב/)).toBeInTheDocument()
  })

  it('shows positive amounts in green and negative in red', () => {
    mockUseCoinTransactions.mockReturnValue({
      transactions: [fakeTx, negTx], totalEarned: 100, totalSpent: 30, loading: false, error: null,
    })
    renderPage()
    const positive = screen.getByText('+10')
    const negative = screen.getByText('−5')
    expect(positive).toHaveClass('text-green-600')
    expect(negative).toHaveClass('text-destructive')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/pages/player/profile/__tests__/ProfilePage.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the page**

Write this exact content to `src/pages/player/profile/ProfilePage.tsx`:

```typescript
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useAchievements } from '../../../hooks/useAchievements'
import { useCoinTransactions } from '../../../hooks/useCoinTransactions'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar'
import { Button } from '../../../components/ui/button'
import type { CoinReason } from '../../../types/database'

const REASON_LABEL: Record<CoinReason, string> = {
  chore_completed: 'משימה הושלמה',
  reward_redeemed: 'פדיון פרס',
  trade_transfer: 'העברת מסחר',
  penalty: 'קנס',
  manual_bonus: 'בונוס',
  refund: 'החזר',
}

type Tab = 'coins' | 'achievements' | 'trades'

export default function ProfilePage() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('coins')
  const { achievements, earnedIds, loading: achLoading } = useAchievements(profile?.id)
  const { transactions, totalEarned, totalSpent, loading: txLoading, error: txError } = useCoinTransactions(profile?.id)

  const loading = txLoading || achLoading

  const tabs: { key: Tab; label: string }[] = [
    { key: 'coins', label: '💰 מטבעות' },
    { key: 'achievements', label: '🏆 הישגים' },
    { key: 'trades', label: '🤝 מסחר' },
  ]

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-col items-center gap-2 py-4">
        <Avatar className="h-20 w-20">
          <AvatarImage src={profile?.avatar_url ?? undefined} />
          <AvatarFallback className="text-2xl">{profile?.name?.[0] ?? 'מ'}</AvatarFallback>
        </Avatar>
        <p className="text-xl font-bold">{profile?.name}</p>
        <p className="text-sm text-muted-foreground">🪙 {profile?.coin_balance ?? 0} מטבעות</p>
        <div className="w-full max-w-xs space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>רמת אמון</span>
            <span>{profile?.trust_level ?? 0} / 5</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${((profile?.trust_level ?? 0) / 5) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex rounded-lg border overflow-hidden">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : activeTab === 'coins' ? (
        <div className="space-y-4">
          {txError && <p role="alert" className="text-sm text-destructive">{txError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">סה&quot;כ הרוויח</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">{totalEarned}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">סה&quot;כ הוציא</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-destructive">{totalSpent}</p>
              </CardContent>
            </Card>
          </div>
          {transactions.length === 0 ? (
            <p className="text-muted-foreground text-sm">אין עדיין עסקאות.</p>
          ) : (
            <div className="space-y-2">
              {transactions.map(tx => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm">{REASON_LABEL[tx.reason]}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(tx.created_at).toLocaleDateString('he-IL')}
                    </p>
                  </div>
                  <span className={`font-semibold text-sm ${tx.amount > 0 ? 'text-green-600' : 'text-destructive'}`}>
                    {tx.amount > 0 ? `+${tx.amount}` : `−${Math.abs(tx.amount)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'achievements' ? (
        <Card>
          <CardContent className="py-4 space-y-3">
            <p className="font-semibold text-center">
              {earnedIds.size} מתוך {achievements.length || 7} הישגים
            </p>
            {earnedIds.size > 0 && (
              <div className="flex flex-wrap gap-2 justify-center text-2xl">
                {achievements.filter(a => earnedIds.has(a.id)).map(a => (
                  <span key={a.id}>{a.icon}</span>
                ))}
              </div>
            )}
            {earnedIds.size === 0 && (
              <p className="text-sm text-muted-foreground text-center">טרם הושגו הישגים.</p>
            )}
            <div className="flex justify-center">
              <Button asChild variant="outline" size="sm">
                <Link to="/player/achievements">ראה את כל ההישגים</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="opacity-50">
          <CardContent className="py-8 flex flex-col items-center gap-2">
            <span className="text-4xl"><span aria-hidden="true">🔒</span></span>
            <p className="text-xl font-semibold">שוק ההחלפות</p>
            <p className="text-sm text-muted-foreground">תכונה זו תהיה זמינה בקרוב</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npx vitest run src/pages/player/profile/__tests__/ProfilePage.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores && git add src/pages/player/profile/ProfilePage.tsx src/pages/player/profile/__tests__/ProfilePage.test.tsx && git commit -m "feat: add player profile page with coins, achievements, and trade placeholder tabs"
```

---

## Task 3: Route + Nav

**Files:**
- Modify: `src/router.tsx`
- Modify: `src/components/layout/PlayerLayout.tsx`

No TDD here — routing changes are trivial to verify by running the full test suite.

- [ ] **Step 1: Add route to `src/router.tsx`**

Read the file first. Add this import near the other player page imports:

```typescript
import ProfilePage from './pages/player/profile/ProfilePage'
```

In the `/player` children array, add after `{ path: 'achievements', element: <AchievementsPage /> }`:

```typescript
{ path: 'profile', element: <ProfilePage /> },
```

- [ ] **Step 2: Update `src/components/layout/PlayerLayout.tsx`**

Read the file first. Make two changes:

**Change 1:** Add `Link` to the react-router-dom import:
```typescript
import { Outlet, NavLink, Link } from 'react-router-dom'
```

**Change 2:** Wrap the avatar+name block in a `<Link>`. Replace:
```typescript
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
```
With:
```typescript
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
```

**Change 3:** Add "פרופיל" nav link after the "הישגים" NavLink:
```typescript
          <NavLink
            to="/player/profile"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            פרופיל
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
cd D:/Claude_Projects/family-chores && git add src/router.tsx src/components/layout/PlayerLayout.tsx && git commit -m "feat: add profile route and nav entry points in PlayerLayout"
```

---

## Self-Review

**1. Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| Fixed header: avatar, name, coin balance, trust level bar | Task 2 — `ProfilePage` header section |
| Trust level shown as progress bar (X / 5) | Task 2 — inline `div`-based progress bar (no `Progress` component installed) |
| Tab bar: מטבעות / הישגים / מסחר | Task 2 — `useState<Tab>` |
| Coins tab: summary stats (totalEarned, totalSpent) | Task 2 — 2-column card grid |
| Coins tab: transaction list (last 20, with reason, amount, date) | Tasks 1 + 2 |
| Totals computed from ALL transactions, not just displayed 20 | Task 1 — two parallel queries |
| Positive amounts green, negative red | Task 2 — conditional className |
| Empty state for no transactions | Task 2 — `אין עדיין עסקאות.` |
| Achievements tab: X מתוך 7 count + earned icons + CTA | Task 2 — reuses `useAchievements` |
| Trade tab: locked placeholder card | Task 2 — grayed card with 🔒 |
| Route `/player/profile` | Task 3 — router.tsx |
| Avatar tap → profile (mobile entry point) | Task 3 — PlayerLayout `<Link>` |
| "פרופיל" desktop nav link | Task 3 — PlayerLayout NavLink |

**2. Placeholder scan:** No TBDs, no "implement later", all steps contain complete code. ✅

**3. Type consistency:**
- `useCoinTransactions` returns `UseCoinTransactionsResult` with `transactions: CoinTransaction[]`, `totalEarned: number`, `totalSpent: number` — all used correctly in `ProfilePage` ✅
- `CoinReason` used as key type for `REASON_LABEL` map — matches all 6 values in `src/types/database.ts` ✅
- `useAchievements` return shape (`achievements`, `earnedIds`) matches existing implementation ✅
