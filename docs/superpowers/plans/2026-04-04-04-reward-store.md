# Reward Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full reward lifecycle — admin creates/manages rewards, players browse and redeem with coins, admin grants or declines pending redemptions.

**Architecture:** Coins are deducted immediately on redemption (optimistic) via a `redeem_reward` SECURITY DEFINER RPC that atomically inserts the redemption record and coin transaction. If the admin declines, a `decline_redemption` RPC refunds the coins atomically. Grant requires no coin operation (already deducted), so it uses a direct Supabase client update.

**Tech Stack:** React 18, TypeScript, Tailwind, shadcn/ui v2.5.0, Supabase JS v2, Vitest + React Testing Library

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/008_rewards.sql` | Create | `rewards` + `reward_redemptions` tables, RLS |
| `supabase/migrations/009_reward_rpcs.sql` | Create | `redeem_reward`, `decline_redemption` RPCs |
| `src/types/database.ts` | Modify | Add `resolved_by` to `RewardRedemption` |
| `src/hooks/useRewards.ts` | Create | Fetch non-archived rewards (shared by admin + player) |
| `src/hooks/usePendingRedemptions.ts` | Create | Admin hook: pending redemptions with reward + player details |
| `src/hooks/__tests__/useRewards.test.ts` | Create | Hook tests |
| `src/hooks/__tests__/usePendingRedemptions.test.ts` | Create | Hook tests |
| `src/pages/admin/rewards/RewardsPage.tsx` | Create | Admin list: active rewards + pending proposals |
| `src/pages/admin/rewards/RewardFormPage.tsx` | Create | Admin create/edit reward form |
| `src/pages/admin/rewards/RedemptionsPage.tsx` | Create | Admin review: grant or decline pending redemptions |
| `src/pages/admin/rewards/__tests__/RewardsPage.test.tsx` | Create | Page tests |
| `src/pages/admin/rewards/__tests__/RewardFormPage.test.tsx` | Create | Page tests |
| `src/pages/admin/rewards/__tests__/RedemptionsPage.test.tsx` | Create | Page tests |
| `src/pages/player/store/RewardStorePage.tsx` | Create | Player browse + redeem with confirmation dialog |
| `src/pages/player/store/__tests__/RewardStorePage.test.tsx` | Create | Page tests |
| `src/router.tsx` | Modify | Add admin + player reward routes |
| `src/components/layout/AdminLayout.tsx` | Modify | Add "פרסים" + "מימושים" nav links |
| `src/components/layout/PlayerLayout.tsx` | Modify | Add "החנות" nav link |
| `src/pages/admin/AdminDashboard.tsx` | Modify | Add pending redemptions count card |

---

### Task 1: DB migration — rewards + reward_redemptions tables

**Files:**
- Create: `supabase/migrations/008_rewards.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Write the migration file**

```sql
-- rewards table
CREATE TABLE rewards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  coin_cost   INTEGER NOT NULL CHECK (coin_cost > 0),
  type        TEXT NOT NULL DEFAULT 'store'
                CHECK (type IN ('store', 'manual_bonus')),
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'pending_approval', 'archived')),
  proposed_by UUID REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),
  stock       INTEGER,          -- NULL = unlimited
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;

-- Players (and admins as family members) can view active store rewards in their family
CREATE POLICY "family_can_view_active_rewards" ON rewards
  FOR SELECT
  USING (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    AND status = 'active'
  );

-- Admins have full access to all rewards in their family (overrides SELECT above for admins)
CREATE POLICY "admins_full_access_rewards" ON rewards
  FOR ALL
  USING (
    family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    AND is_admin()
  );

-- reward_redemptions table
CREATE TABLE reward_redemptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id        UUID NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  redeemed_by      UUID NOT NULL REFERENCES profiles(id),
  coin_cost_at_time INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'granted', 'declined')),
  redeemed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID REFERENCES profiles(id)
);

ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;

-- Players can view their own redemptions
CREATE POLICY "players_view_own_redemptions" ON reward_redemptions
  FOR SELECT
  USING (redeemed_by = auth.uid());

-- Admins can view all redemptions for rewards in their family
CREATE POLICY "admins_view_family_redemptions" ON reward_redemptions
  FOR SELECT
  USING (
    reward_id IN (
      SELECT id FROM rewards
      WHERE family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    )
    AND is_admin()
  );

-- Admins can update redemption status (grant/decline)
CREATE POLICY "admins_update_redemptions" ON reward_redemptions
  FOR UPDATE
  USING (
    reward_id IN (
      SELECT id FROM rewards
      WHERE family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())
    )
    AND is_admin()
  );
```

- [ ] **Step 2: Add `resolved_by` to `RewardRedemption` in `src/types/database.ts`**

Find this block:
```typescript
export interface RewardRedemption {
  id: string
  reward_id: string
  redeemed_by: string
  coin_cost_at_time: number
  status: RedemptionStatus
  redeemed_at: string
  resolved_at: string | null
}
```

Replace with:
```typescript
export interface RewardRedemption {
  id: string
  reward_id: string
  redeemed_by: string
  coin_cost_at_time: number
  status: RedemptionStatus
  redeemed_at: string
  resolved_at: string | null
  resolved_by: string | null
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/008_rewards.sql src/types/database.ts
git commit -m "feat: add rewards and reward_redemptions tables with RLS"
```

---

### Task 2: DB migration — redeem_reward + decline_redemption RPCs

**Files:**
- Create: `supabase/migrations/009_reward_rpcs.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- redeem_reward: called by a player.
-- Validates stock and balance, atomically deducts coins and creates a pending redemption.
CREATE OR REPLACE FUNCTION redeem_reward(p_reward_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_reward       rewards%ROWTYPE;
  v_balance      INT;
  v_redemption_id UUID;
BEGIN
  SELECT * INTO v_reward FROM rewards WHERE id = p_reward_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reward not found';
  END IF;
  IF v_reward.status <> 'active' THEN
    RAISE EXCEPTION 'Reward is not active';
  END IF;
  IF v_reward.stock IS NOT NULL AND v_reward.stock <= 0 THEN
    RAISE EXCEPTION 'Reward is out of stock';
  END IF;

  SELECT coin_balance INTO v_balance FROM profiles WHERE id = auth.uid();
  IF v_balance < v_reward.coin_cost THEN
    RAISE EXCEPTION 'Insufficient coin balance';
  END IF;

  -- Decrement stock if limited
  IF v_reward.stock IS NOT NULL THEN
    UPDATE rewards SET stock = stock - 1 WHERE id = p_reward_id;
  END IF;

  -- Create pending redemption
  INSERT INTO reward_redemptions (reward_id, redeemed_by, coin_cost_at_time, status)
    VALUES (p_reward_id, auth.uid(), v_reward.coin_cost, 'pending')
    RETURNING id INTO v_redemption_id;

  -- Deduct coins
  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
    VALUES (auth.uid(), v_reward.family_id, -v_reward.coin_cost, 'reward_redeemed', v_redemption_id);

  UPDATE profiles
    SET coin_balance = coin_balance - v_reward.coin_cost
    WHERE id = auth.uid();

  RETURN v_redemption_id;
END;
$$;

-- decline_redemption: admin only.
-- Marks redemption declined, restores stock, and refunds coins atomically.
CREATE OR REPLACE FUNCTION decline_redemption(p_redemption_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_redemption reward_redemptions%ROWTYPE;
  v_reward     rewards%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can decline redemptions';
  END IF;

  SELECT * INTO v_redemption FROM reward_redemptions WHERE id = p_redemption_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;
  IF v_redemption.status <> 'pending' THEN
    RAISE EXCEPTION 'Redemption is not pending';
  END IF;

  SELECT * INTO v_reward FROM rewards WHERE id = v_redemption.reward_id;

  -- Restore stock if reward has a limit
  IF v_reward.stock IS NOT NULL THEN
    UPDATE rewards SET stock = stock + 1 WHERE id = v_reward.id;
  END IF;

  UPDATE reward_redemptions
    SET status = 'declined',
        resolved_at = now(),
        resolved_by = auth.uid()
    WHERE id = p_redemption_id;

  -- Refund coins
  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
    VALUES (
      v_redemption.redeemed_by,
      v_reward.family_id,
      v_redemption.coin_cost_at_time,
      'refund',
      p_redemption_id
    );

  UPDATE profiles
    SET coin_balance = coin_balance + v_redemption.coin_cost_at_time
    WHERE id = v_redemption.redeemed_by;
END;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/009_reward_rpcs.sql
git commit -m "feat: add redeem_reward and decline_redemption RPCs"
```

---

### Task 3: useRewards hook + tests

**Files:**
- Create: `src/hooks/useRewards.ts`
- Create: `src/hooks/__tests__/useRewards.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/hooks/__tests__/useRewards.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useRewards } from '../useRewards'

const fakeReward = {
  id: 'r1',
  family_id: 'f1',
  title: 'גלידה',
  description: null,
  coin_cost: 20,
  type: 'store' as const,
  status: 'active' as const,
  proposed_by: null,
  approved_by: null,
  stock: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

describe('useRewards', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useRewards())
    expect(result.current.loading).toBe(true)
    expect(result.current.rewards).toEqual([])
  })

  it('returns rewards after successful fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeReward], error: null }))
    const { result } = renderHook(() => useRewards())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rewards).toEqual([fakeReward])
    expect(result.current.error).toBeNull()
  })

  it('sets error on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאת שרת' } }))
    const { result } = renderHook(() => useRewards())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאת שרת')
    expect(result.current.rewards).toEqual([])
  })

  it('refetch re-queries and updates rewards', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeReward], error: null }))
    const { result } = renderHook(() => useRewards())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const updated = { ...fakeReward, title: 'שוקולד' }
    mockFrom.mockReturnValue(makeFromMock({ data: [updated], error: null }))
    result.current.refetch()

    await waitFor(() => expect(result.current.rewards[0].title).toBe('שוקולד'))
  })
})
```

- [ ] **Step 2: Run test — expect FAIL with "Cannot find module '../useRewards'"**

```bash
cd /d/Claude_Projects/family-chores && npm run test -- src/hooks/__tests__/useRewards.test.ts --run
```

- [ ] **Step 3: Implement `useRewards`**

```typescript
// src/hooks/useRewards.ts
import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Reward } from '../types/database'

interface UseRewardsResult {
  rewards: Reward[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useRewards(): UseRewardsResult {
  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchRewards = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('rewards')
      .select('*')
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setRewards((data as Reward[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchRewards()
  }, [fetchRewards])

  return { rewards, loading, error, refetch: fetchRewards }
}
```

- [ ] **Step 4: Run test — expect PASS (4/4)**

```bash
npm run test -- src/hooks/__tests__/useRewards.test.ts --run
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRewards.ts src/hooks/__tests__/useRewards.test.ts
git commit -m "feat: add useRewards hook with tests"
```

---

### Task 4: usePendingRedemptions hook + tests

**Files:**
- Create: `src/hooks/usePendingRedemptions.ts`
- Create: `src/hooks/__tests__/usePendingRedemptions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/hooks/__tests__/usePendingRedemptions.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { usePendingRedemptions } from '../usePendingRedemptions'

const fakeRedemption = {
  id: 'red1',
  reward_id: 'r1',
  redeemed_by: 'p1',
  coin_cost_at_time: 20,
  status: 'pending' as const,
  redeemed_at: '2026-04-04T10:00:00Z',
  resolved_at: null,
  rewards: { title: 'גלידה', coin_cost: 20 },
  profiles: { name: 'דנה' },
}

function makeFromMock(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

describe('usePendingRedemptions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => usePendingRedemptions())
    expect(result.current.loading).toBe(true)
    expect(result.current.redemptions).toEqual([])
  })

  it('returns redemptions with nested reward and player details', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeRedemption], error: null }))
    const { result } = renderHook(() => usePendingRedemptions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.redemptions).toEqual([fakeRedemption])
    expect(result.current.error).toBeNull()
  })

  it('sets error on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאה' } }))
    const { result } = renderHook(() => usePendingRedemptions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאה')
    expect(result.current.redemptions).toEqual([])
  })

  it('refetch re-queries', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeRedemption], error: null }))
    const { result } = renderHook(() => usePendingRedemptions())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockFrom.mockReturnValue(makeFromMock({ data: [], error: null }))
    result.current.refetch()
    await waitFor(() => expect(result.current.redemptions).toEqual([]))
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test -- src/hooks/__tests__/usePendingRedemptions.test.ts --run
```

- [ ] **Step 3: Implement `usePendingRedemptions`**

```typescript
// src/hooks/usePendingRedemptions.ts
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

export interface RedemptionWithDetails {
  id: string
  reward_id: string
  redeemed_by: string
  coin_cost_at_time: number
  status: 'pending' | 'granted' | 'declined'
  redeemed_at: string
  resolved_at: string | null
  rewards: { title: string; coin_cost: number }
  profiles: { name: string }
}

export interface UsePendingRedemptionsResult {
  redemptions: RedemptionWithDetails[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function usePendingRedemptions(): UsePendingRedemptionsResult {
  const [redemptions, setRedemptions] = useState<RedemptionWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchRedemptions = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('reward_redemptions')
      .select(`
        id,
        reward_id,
        redeemed_by,
        coin_cost_at_time,
        status,
        redeemed_at,
        resolved_at,
        rewards!inner(title, coin_cost),
        profiles!redeemed_by(name)
      `)
      .eq('status', 'pending')
      .order('redeemed_at', { ascending: true })
    if (!mountedRef.current) return
    if (error) {
      setError(error.message)
    } else {
      setRedemptions((data as RedemptionWithDetails[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchRedemptions() }, [fetchRedemptions])

  return { redemptions, loading, error, refetch: fetchRedemptions }
}
```

- [ ] **Step 4: Run test — expect PASS (4/4)**

```bash
npm run test -- src/hooks/__tests__/usePendingRedemptions.test.ts --run
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePendingRedemptions.ts src/hooks/__tests__/usePendingRedemptions.test.ts
git commit -m "feat: add usePendingRedemptions hook with tests"
```

---

### Task 5: Admin RewardsPage + tests

**Files:**
- Create: `src/pages/admin/rewards/RewardsPage.tsx`
- Create: `src/pages/admin/rewards/__tests__/RewardsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/pages/admin/rewards/__tests__/RewardsPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useRewards', () => ({
  useRewards: vi.fn(() => ({ rewards: [], loading: false, error: null, refetch: mockRefetch })),
}))

import { useRewards } from '../../../../hooks/useRewards'
import RewardsPage from '../RewardsPage'

const mockUseRewards = vi.mocked(useRewards)

const activeReward = {
  id: 'r1', family_id: 'f1', title: 'גלידה', description: null,
  coin_cost: 20, type: 'store' as const, status: 'active' as const,
  proposed_by: null, approved_by: null, stock: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const pendingReward = {
  ...activeReward, id: 'r2', title: 'סרט קולנוע', status: 'pending_approval' as const,
}

const limitedReward = {
  ...activeReward, id: 'r3', title: 'פיצה', stock: 3,
}

function renderPage() {
  return render(<MemoryRouter><RewardsPage /></MemoryRouter>)
}

describe('RewardsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading spinner while loading', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: true, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no active rewards', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('אין פרסים פעילים')).toBeInTheDocument()
  })

  it('shows active reward title and coin cost', () => {
    mockUseRewards.mockReturnValue({ rewards: [activeReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('גלידה')).toBeInTheDocument()
    expect(screen.getByText(/20 מטבעות/)).toBeInTheDocument()
  })

  it('shows stock badge for limited-stock reward', () => {
    mockUseRewards.mockReturnValue({ rewards: [limitedReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('מלאי: 3')).toBeInTheDocument()
  })

  it('shows pending proposal section with approve and reject buttons', () => {
    mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('סרט קולנוע')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'אשר' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'דחה' })).toBeInTheDocument()
  })

  it('archive calls update with status archived and refetches', async () => {
    mockUseRewards.mockReturnValue({ rewards: [activeReward], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'ארכיון' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'archived' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows error alert when archive fails', async () => {
    mockUseRewards.mockReturnValue({ rewards: [activeReward], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } })
    mockFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: mockEq }) })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'ארכיון' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בארכוב הפרס')
    )
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it('approve sets status active and refetches', async () => {
    mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: mockEq }) })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows link to create new reward', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('link', { name: 'פרס חדש' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test -- src/pages/admin/rewards/__tests__/RewardsPage.test.tsx --run
```

- [ ] **Step 3: Implement `RewardsPage`**

```typescript
// src/pages/admin/rewards/RewardsPage.tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useRewards } from '../../../hooks/useRewards'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Separator } from '../../../components/ui/separator'
import type { Reward } from '../../../types/database'

export default function RewardsPage() {
  const { rewards, loading, error, refetch } = useRewards()
  const [mutationError, setMutationError] = useState<string | null>(null)

  const activeRewards = rewards.filter(r => r.status === 'active')
  const pendingRewards = rewards.filter(r => r.status === 'pending_approval')

  async function archiveReward(reward: Reward) {
    setMutationError(null)
    const { error } = await supabase.from('rewards').update({ status: 'archived' }).eq('id', reward.id)
    if (error) { setMutationError('שגיאה בארכוב הפרס') } else { refetch() }
  }

  async function approveReward(reward: Reward) {
    setMutationError(null)
    const { error } = await supabase.from('rewards').update({ status: 'active' }).eq('id', reward.id)
    if (error) { setMutationError('שגיאה באישור ההצעה') } else { refetch() }
  }

  async function rejectReward(reward: Reward) {
    setMutationError(null)
    const { error } = await supabase.from('rewards').update({ status: 'archived' }).eq('id', reward.id)
    if (error) { setMutationError('שגיאה בדחיית ההצעה') } else { refetch() }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div role="status" className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return <p className="text-destructive py-4">{error}</p>
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ניהול פרסים</h1>
        <Button asChild>
          <Link to="/admin/rewards/new">פרס חדש</Link>
        </Button>
      </div>

      {mutationError && (
        <p role="alert" className="text-sm text-destructive">{mutationError}</p>
      )}

      {pendingRewards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">הצעות ממתינות לאישור</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingRewards.map(reward => (
              <div key={reward.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{reward.title}</p>
                  <p className="text-sm text-muted-foreground">{reward.coin_cost} מטבעות</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveReward(reward)}>אשר</Button>
                  <Button size="sm" variant="outline" onClick={() => rejectReward(reward)}>דחה</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">פרסים פעילים</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {activeRewards.length === 0 ? (
            <p className="text-muted-foreground text-sm">אין פרסים פעילים</p>
          ) : (
            activeRewards.map((reward, i) => (
              <div key={reward.id}>
                {i > 0 && <Separator className="my-2" />}
                <div className="flex items-center justify-between py-1">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{reward.title}</span>
                      {reward.stock !== null && (
                        <Badge variant="secondary">מלאי: {reward.stock}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{reward.coin_cost} מטבעות</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/admin/rewards/${reward.id}/edit`}>עריכה</Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => archiveReward(reward)}>
                      ארכיון
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect PASS (9/9)**

```bash
npm run test -- src/pages/admin/rewards/__tests__/RewardsPage.test.tsx --run
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/rewards/RewardsPage.tsx src/pages/admin/rewards/__tests__/RewardsPage.test.tsx
git commit -m "feat: add admin rewards list page with tests"
```

---

### Task 6: Admin RewardFormPage + tests

**Files:**
- Create: `src/pages/admin/rewards/RewardFormPage.tsx`
- Create: `src/pages/admin/rewards/__tests__/RewardFormPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/pages/admin/rewards/__tests__/RewardFormPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', family_id: 'f1' } }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import RewardFormPage from '../RewardFormPage'

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/admin/rewards/new']}>
      <Routes>
        <Route path="/admin/rewards/new" element={<RewardFormPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function renderEdit(id = 'r1') {
  return render(
    <MemoryRouter initialEntries={[`/admin/rewards/${id}/edit`]}>
      <Routes>
        <Route path="/admin/rewards/:id/edit" element={<RewardFormPage />} />
      </Routes>
    </MemoryRouter>
  )
}

const existingReward = {
  id: 'r1', family_id: 'f1', title: 'גלידה', description: 'גלידת וניל',
  coin_cost: 20, type: 'store', status: 'active',
  proposed_by: null, approved_by: null, stock: 5,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

describe('RewardFormPage — create mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders all form fields with Hebrew labels', () => {
    renderCreate()
    expect(screen.getByLabelText('שם הפרס')).toBeInTheDocument()
    expect(screen.getByLabelText('תיאור')).toBeInTheDocument()
    expect(screen.getByLabelText('עלות במטבעות')).toBeInTheDocument()
    expect(screen.getByLabelText('מלאי (ריק = ללא הגבלה)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שמור' })).toBeInTheDocument()
  })

  it('creates a reward on submit and navigates to /admin/rewards', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם הפרס'), 'גלידה')
    await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
    await userEvent.type(screen.getByLabelText('עלות במטבעות'), '20')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin/rewards'))
  })

  it('shows Hebrew error message when insert fails', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם הפרס'), 'גלידה')
    await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
    await userEvent.type(screen.getByLabelText('עלות במטבעות'), '20')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשמירת הפרס')
    )
  })

  it('disables submit button while saving', async () => {
    let resolve: (v: unknown) => void
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue(new Promise(r => { resolve = r })),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם הפרס'), 'גלידה')
    await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
    await userEvent.type(screen.getByLabelText('עלות במטבעות'), '20')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    expect(screen.getByRole('button', { name: /שומר/ })).toBeDisabled()
    resolve!({ error: null })
  })
})

describe('RewardFormPage — edit mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pre-fills form with existing reward data', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: existingReward, error: null }),
    })
    renderEdit('r1')

    await waitFor(() =>
      expect((screen.getByLabelText('שם הפרס') as HTMLInputElement).value).toBe('גלידה')
    )
    expect((screen.getByLabelText('תיאור') as HTMLTextAreaElement).value).toBe('גלידת וניל')
    expect((screen.getByLabelText('מלאי (ריק = ללא הגבלה)') as HTMLInputElement).value).toBe('5')
  })

  it('shows error when edit-mode fetch fails', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    })
    renderEdit('r1')

    await waitFor(() =>
      expect(screen.getByRole('alert')).toBeInTheDocument()
    )
  })

  it('updates reward on submit and navigates to /admin/rewards', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: existingReward, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
    renderEdit('r1')

    await waitFor(() =>
      expect((screen.getByLabelText('שם הפרס') as HTMLInputElement).value).toBe('גלידה')
    )

    await userEvent.clear(screen.getByLabelText('שם הפרס'))
    await userEvent.type(screen.getByLabelText('שם הפרס'), 'שוקולד')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin/rewards'))
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test -- src/pages/admin/rewards/__tests__/RewardFormPage.test.tsx --run
```

- [ ] **Step 3: Implement `RewardFormPage`**

```typescript
// src/pages/admin/rewards/RewardFormPage.tsx
import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Textarea } from '../../../components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import type { RewardType, RewardStatus } from '../../../types/database'

export default function RewardFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = id !== undefined
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coinCost, setCoinCost] = useState('10')
  const [stock, setStock] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isEditMode) return
    supabase
      .from('rewards')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error) { setError('שגיאה בטעינת הפרס'); return }
        if (!data) return
        setTitle(data.title)
        setDescription(data.description ?? '')
        setCoinCost(String(data.coin_cost))
        setStock(data.stock !== null ? String(data.stock) : '')
      })
  }, [id, isEditMode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      if (!profile?.family_id) {
        setError('שגיאה בשמירת הפרס')
        setSaving(false)
        return
      }

      const payload = {
        title,
        description: description || null,
        coin_cost: Number(coinCost),
        stock: stock !== '' ? Number(stock) : null,
      }

      let err: { message: string } | null = null

      if (isEditMode) {
        const result = await supabase.from('rewards').update(payload).eq('id', id!)
        err = result.error
      } else {
        const result = await supabase.from('rewards').insert({
          ...payload,
          family_id: profile.family_id,
          type: 'store' as RewardType,
          status: 'active' as RewardStatus,
        })
        err = result.error
      }

      if (err) {
        setError('שגיאה בשמירת הפרס')
      } else {
        navigate('/admin/rewards')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg" dir="rtl">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/rewards">← חזרה</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isEditMode ? 'עריכת פרס' : 'פרס חדש'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="title">שם הפרס</Label>
              <Input
                id="title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="description">תיאור</Label>
              <Textarea
                id="description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="coinCost">עלות במטבעות</Label>
              <Input
                id="coinCost"
                type="number"
                min={1}
                value={coinCost}
                onChange={e => setCoinCost(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="stock">מלאי (ריק = ללא הגבלה)</Label>
              <Input
                id="stock"
                type="number"
                min={0}
                value={stock}
                onChange={e => setStock(e.target.value)}
                placeholder="ללא הגבלה"
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">{error}</p>
            )}

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'שומר...' : 'שמור'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect PASS (7/7)**

```bash
npm run test -- src/pages/admin/rewards/__tests__/RewardFormPage.test.tsx --run
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/rewards/RewardFormPage.tsx src/pages/admin/rewards/__tests__/RewardFormPage.test.tsx
git commit -m "feat: add admin reward form page with tests"
```

---

### Task 7: Admin RedemptionsPage + tests

**Files:**
- Create: `src/pages/admin/rewards/RedemptionsPage.tsx`
- Create: `src/pages/admin/rewards/__tests__/RedemptionsPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/pages/admin/rewards/__tests__/RedemptionsPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/usePendingRedemptions', () => ({
  usePendingRedemptions: vi.fn(() => ({
    redemptions: [],
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))

import { usePendingRedemptions } from '../../../../hooks/usePendingRedemptions'
import RedemptionsPage from '../RedemptionsPage'

const mockUsePendingRedemptions = vi.mocked(usePendingRedemptions)

const fakeRedemption = {
  id: 'red1',
  reward_id: 'r1',
  redeemed_by: 'p1',
  coin_cost_at_time: 20,
  status: 'pending' as const,
  redeemed_at: '2026-04-04T10:00:00Z',
  resolved_at: null,
  rewards: { title: 'גלידה', coin_cost: 20 },
  profiles: { name: 'דנה' },
}

function renderPage() {
  return render(<MemoryRouter><RedemptionsPage /></MemoryRouter>)
}

describe('RedemptionsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading spinner while loading', () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: true, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no pending redemptions', () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('אין בקשות מימוש ממתינות.')).toBeInTheDocument()
  })

  it('shows redemption with reward title, player name, and cost', () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('גלידה')).toBeInTheDocument()
    expect(screen.getByText(/דנה/)).toBeInTheDocument()
    expect(screen.getByText(/20 מטבעות/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'אשר' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'דחה' })).toBeInTheDocument()
  })

  it('grant calls direct update and refetches', async () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'granted' })
      )
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows error when grant fails', async () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: { message: 'denied' } })
    mockFrom.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: mockEq }) })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה במתן הפרס')
    )
    expect(mockRefetch).not.toHaveBeenCalled()
  })

  it('decline calls decline_redemption RPC and refetches', async () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('decline_redemption', { p_redemption_id: 'red1' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows error when decline fails', async () => {
    mockUsePendingRedemptions.mockReturnValue({ redemptions: [fakeRedemption], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'denied' } })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בדחיית הבקשה')
    )
    expect(mockRefetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test -- src/pages/admin/rewards/__tests__/RedemptionsPage.test.tsx --run
```

- [ ] **Step 3: Implement `RedemptionsPage`**

```typescript
// src/pages/admin/rewards/RedemptionsPage.tsx
import { useState } from 'react'
import { usePendingRedemptions, type RedemptionWithDetails } from '../../../hooks/usePendingRedemptions'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'

export default function RedemptionsPage() {
  const { redemptions, loading, refetch } = usePendingRedemptions()
  const [actionError, setActionError] = useState<string | null>(null)

  async function grant(redemption: RedemptionWithDetails) {
    setActionError(null)
    const { error } = await supabase
      .from('reward_redemptions')
      .update({ status: 'granted', resolved_at: new Date().toISOString() })
      .eq('id', redemption.id)
    if (error) { setActionError('שגיאה במתן הפרס'); return }
    refetch()
  }

  async function decline(redemption: RedemptionWithDetails) {
    setActionError(null)
    const { error } = await supabase.rpc('decline_redemption', { p_redemption_id: redemption.id })
    if (error) { setActionError('שגיאה בדחיית הבקשה'); return }
    refetch()
  }

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">בקשות מימוש</h1>

      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : redemptions.length === 0 ? (
        <p className="text-muted-foreground">אין בקשות מימוש ממתינות.</p>
      ) : (
        <div className="space-y-3">
          {redemptions.map(r => (
            <Card key={r.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{r.rewards.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.profiles.name} · {r.coin_cost_at_time} מטבעות · {new Date(r.redeemed_at).toLocaleDateString('he-IL')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button size="sm" onClick={() => grant(r)}>אשר</Button>
                    <Button variant="destructive" size="sm" onClick={() => decline(r)}>דחה</Button>
                  </div>
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

- [ ] **Step 4: Run test — expect PASS (6/6)**

```bash
npm run test -- src/pages/admin/rewards/__tests__/RedemptionsPage.test.tsx --run
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/rewards/RedemptionsPage.tsx src/pages/admin/rewards/__tests__/RedemptionsPage.test.tsx
git commit -m "feat: add admin redemptions review page with tests"
```

---

### Task 8: Player RewardStorePage + tests

**Files:**
- Create: `src/pages/player/store/RewardStorePage.tsx`
- Create: `src/pages/player/store/__tests__/RewardStorePage.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/pages/player/store/__tests__/RewardStorePage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockRpc } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useRewards', () => ({
  useRewards: vi.fn(() => ({ rewards: [], loading: false, error: null, refetch: mockRefetch })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', family_id: 'f1', coin_balance: 50 } }),
}))

import { useRewards } from '../../../../hooks/useRewards'
import RewardStorePage from '../RewardStorePage'

const mockUseRewards = vi.mocked(useRewards)

const fakeReward = {
  id: 'r1', family_id: 'f1', title: 'גלידה', description: 'גלידת וניל',
  coin_cost: 20, type: 'store' as const, status: 'active' as const,
  proposed_by: null, approved_by: null, stock: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const expensiveReward = { ...fakeReward, id: 'r2', title: 'נסיעה לפארק', coin_cost: 100 }

function renderPage() {
  return render(<MemoryRouter><RewardStorePage /></MemoryRouter>)
}

describe('RewardStorePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading spinner while loading', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: true, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no store rewards', () => {
    mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('אין פרסים זמינים כרגע.')).toBeInTheDocument()
  })

  it('shows reward title, description, and coin cost', () => {
    mockUseRewards.mockReturnValue({ rewards: [fakeReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('גלידה')).toBeInTheDocument()
    expect(screen.getByText('גלידת וניל')).toBeInTheDocument()
    expect(screen.getByText(/20 מטבעות/)).toBeInTheDocument()
  })

  it('redeem button opens confirmation dialog', async () => {
    mockUseRewards.mockReturnValue({ rewards: [fakeReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'מימוש' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/גלידה/)).toBeInTheDocument()
  })

  it('confirming redemption calls redeem_reward RPC and shows success', async () => {
    mockUseRewards.mockReturnValue({ rewards: [fakeReward], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'מימוש' }))
    await userEvent.click(screen.getByRole('button', { name: 'אשר מימוש' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('redeem_reward', { p_reward_id: 'r1' })
    })
    await waitFor(() =>
      expect(screen.getByText(/גלידה הוזמן בהצלחה/)).toBeInTheDocument()
    )
  })

  it('shows insufficient balance error when RPC fails with balance message', async () => {
    mockUseRewards.mockReturnValue({ rewards: [expensiveReward], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'Insufficient coin balance' } })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'מימוש' }))
    await userEvent.click(screen.getByRole('button', { name: 'אשר מימוש' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('אין מספיק מטבעות')
    )
  })

  it('shows out of stock error when RPC fails with stock message', async () => {
    mockUseRewards.mockReturnValue({ rewards: [fakeReward], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'out of stock' } })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'מימוש' }))
    await userEvent.click(screen.getByRole('button', { name: 'אשר מימוש' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('הפרס אזל מהמלאי')
    )
  })

  it('cancelling dialog closes it without calling RPC', async () => {
    mockUseRewards.mockReturnValue({ rewards: [fakeReward], loading: false, error: null, refetch: mockRefetch })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'מימוש' }))
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }))

    expect(mockRpc).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test -- src/pages/player/store/__tests__/RewardStorePage.test.tsx --run
```

- [ ] **Step 3: Implement `RewardStorePage`**

```typescript
// src/pages/player/store/RewardStorePage.tsx
import { useState } from 'react'
import { useRewards } from '../../../hooks/useRewards'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog'
import type { Reward } from '../../../types/database'

export default function RewardStorePage() {
  const { rewards, loading } = useRewards()
  const [confirmTarget, setConfirmTarget] = useState<Reward | null>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const storeRewards = rewards.filter(r => r.type === 'store')

  async function confirmRedeem() {
    if (!confirmTarget) return
    setRedeeming(true)
    setError(null)
    const { error } = await supabase.rpc('redeem_reward', { p_reward_id: confirmTarget.id })
    setRedeeming(false)
    if (error) {
      if (error.message.includes('Insufficient coin balance')) {
        setError('אין מספיק מטבעות')
      } else if (error.message.includes('out of stock')) {
        setError('הפרס אזל מהמלאי')
      } else {
        setError('שגיאה בממשק הפרס')
      }
      setConfirmTarget(null)
      return
    }
    setSuccessMsg(`${confirmTarget.title} הוזמן בהצלחה!`)
    setConfirmTarget(null)
  }

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">החנות</h1>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {successMsg && <p className="text-sm text-green-600 font-medium">{successMsg}</p>}

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : storeRewards.length === 0 ? (
        <p className="text-muted-foreground">אין פרסים זמינים כרגע.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {storeRewards.map(reward => (
            <Card key={reward.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{reward.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {reward.description && (
                  <p className="text-sm text-muted-foreground">{reward.description}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="font-semibold">🪙 {reward.coin_cost} מטבעות</span>
                  {reward.stock !== null && (
                    <span className="text-xs text-muted-foreground">מלאי: {reward.stock}</span>
                  )}
                </div>
                <Button
                  className="w-full"
                  disabled={reward.stock === 0}
                  onClick={() => { setError(null); setSuccessMsg(null); setConfirmTarget(reward) }}
                >
                  מימוש
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!confirmTarget} onOpenChange={open => { if (!open) setConfirmTarget(null) }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>אישור מימוש</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            לממש את <span className="font-semibold">{confirmTarget?.title}</span> תמורת{' '}
            <span className="font-semibold">{confirmTarget?.coin_cost} מטבעות</span>?
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>ביטול</Button>
            <Button onClick={confirmRedeem} disabled={redeeming}>
              {redeeming ? 'מממש...' : 'אשר מימוש'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect PASS (8/8)**

```bash
npm run test -- src/pages/player/store/__tests__/RewardStorePage.test.tsx --run
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/player/store/RewardStorePage.tsx src/pages/player/store/__tests__/RewardStorePage.test.tsx
git commit -m "feat: add player reward store page with tests"
```

---

### Task 9: Wire routes, nav links, and dashboard card

**Files:**
- Modify: `src/router.tsx`
- Modify: `src/components/layout/AdminLayout.tsx`
- Modify: `src/components/layout/PlayerLayout.tsx`
- Modify: `src/pages/admin/AdminDashboard.tsx`

- [ ] **Step 1: Add routes to `src/router.tsx`**

Add these imports after the existing imports:
```typescript
import RewardsPage from './pages/admin/rewards/RewardsPage'
import RewardFormPage from './pages/admin/rewards/RewardFormPage'
import RedemptionsPage from './pages/admin/rewards/RedemptionsPage'
import RewardStorePage from './pages/player/store/RewardStorePage'
```

In the admin children array, after `{ path: 'completions', element: <CompletionsPage /> }`, add:
```typescript
{ path: 'rewards', element: <RewardsPage /> },
{ path: 'rewards/new', element: <RewardFormPage /> },
{ path: 'rewards/:id/edit', element: <RewardFormPage /> },
{ path: 'redemptions', element: <RedemptionsPage /> },
```

In the player children array, after `{ path: 'chores/:assignmentId/complete', element: <CompletionPage /> }`, add:
```typescript
{ path: 'store', element: <RewardStorePage /> },
```

- [ ] **Step 2: Add nav links to `src/components/layout/AdminLayout.tsx`**

After the existing `הגשות` NavLink, add:
```tsx
<NavLink
  to="/admin/rewards"
  className={({ isActive }) =>
    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
  }
>
  פרסים
</NavLink>
<NavLink
  to="/admin/redemptions"
  className={({ isActive }) =>
    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
  }
>
  מימושים
</NavLink>
```

- [ ] **Step 3: Add nav link to `src/components/layout/PlayerLayout.tsx`**

After the existing `בריכה` NavLink, add:
```tsx
<NavLink
  to="/player/store"
  className={({ isActive }) =>
    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
  }
>
  החנות
</NavLink>
```

- [ ] **Step 4: Add pending redemptions card to `src/pages/admin/AdminDashboard.tsx`**

Replace the entire file content with:
```typescript
import { Link } from 'react-router-dom'
import { useChores } from '../../hooks/useChores'
import { usePendingRedemptions } from '../../hooks/usePendingRedemptions'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'

export default function AdminDashboard() {
  const { chores } = useChores()
  const { redemptions } = usePendingRedemptions()
  const pendingCount = chores.filter(c => c.status === 'pending_approval').length
  const pendingRedemptionsCount = redemptions.length

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">דשבורד מנהל</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              הצעות ממתינות לאישור
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingCount}</p>
            <Button variant="link" className="px-0 mt-1 h-auto text-sm" asChild>
              <Link to="/admin/chores">לניהול משימות ←</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              בקשות מימוש ממתינות
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pendingRedemptionsCount}</p>
            <Button variant="link" className="px-0 mt-1 h-auto text-sm" asChild>
              <Link to="/admin/redemptions">לבקשות מימוש ←</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run full test suite — expect all tests pass**

```bash
npm run test -- --run
```

Expected: all existing tests + new tests pass. TypeScript clean:
```bash
npm run build 2>&1 | grep -E "error|warning" | head -20
```

- [ ] **Step 6: Commit**

```bash
git add src/router.tsx src/components/layout/AdminLayout.tsx src/components/layout/PlayerLayout.tsx src/pages/admin/AdminDashboard.tsx
git commit -m "feat: wire reward store routes, nav links, and dashboard card"
```
