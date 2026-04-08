# Player Chore Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full player chore loop — players pick up open-pool chores, submit photo proof of completion, and the admin approves or rejects; coin awards happen atomically via a Postgres RPC.

**Architecture:** Two Postgres SECURITY DEFINER RPCs (`approve_completion`, `reject_completion`) handle coin awards and status updates atomically, bypassing RLS for inserts into `coin_transactions`. Player pages live under `/player`; admin review under `/admin/completions`. Photo uploads go to the private Supabase Storage bucket `completion-photos` (already created in migration 004) at path `{userId}/{uuid}.webp`. Trust-level 4–5 players are auto-approved immediately after submitting — the client calls `approve_completion` on their behalf.

**Tech Stack:** React 18, TypeScript 5, Supabase JS v2 (storage + rpc), browser-image-compression v2, shadcn/ui (Dialog added this plan), React Router v6, Vitest + React Testing Library

**Prerequisite:** Admin user must have a non-null `family_id` in profiles. Players too — pick-up inserts use the RLS-scoped family context.

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/test/setup.ts` | Modified: add `URL.createObjectURL` stub |
| `src/test/mocks/supabase.ts` | Modified: add `rpc` and `storage.from` mocks |
| `src/lib/weekStart.ts` | `getCurrentWeekStart()` → ISO date string for current Sunday |
| `src/lib/photoUtils.ts` | `compressPhoto(file)` → wraps browser-image-compression |
| `src/lib/__tests__/weekStart.test.ts` | Tests for weekStart |
| `src/lib/__tests__/photoUtils.test.ts` | Tests for photoUtils |
| `src/hooks/useChoreAssignments.ts` | Fetch current-week assignments for a given userId |
| `src/hooks/__tests__/useChoreAssignments.test.ts` | Tests for useChoreAssignments |
| `src/hooks/usePendingCompletions.ts` | Admin hook: fetch pending completions with joined chore + player name |
| `src/hooks/__tests__/usePendingCompletions.test.ts` | Tests for usePendingCompletions |
| `src/pages/player/PlayerDashboard.tsx` | Modified: show this week's assignments + coin balance + pick-up link |
| `src/pages/player/__tests__/PlayerDashboard.test.tsx` | New test file for PlayerDashboard |
| `src/pages/player/chores/ChorePoolPage.tsx` | Open-pool chore list; pick-up creates a ChoreAssignment |
| `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx` | Tests for ChorePoolPage |
| `src/pages/player/chores/CompletionPage.tsx` | Photo submission: compress → upload → create ChoreCompletion |
| `src/pages/player/chores/__tests__/CompletionPage.test.tsx` | Tests for CompletionPage |
| `src/pages/admin/completions/CompletionsPage.tsx` | Admin: list pending completions, view photo, approve/reject |
| `src/pages/admin/completions/__tests__/CompletionsPage.test.tsx` | Tests for CompletionsPage |
| `src/router.tsx` | Modified: add player pool + completion + admin completions routes |
| `src/components/layout/PlayerLayout.tsx` | Modified: add "בריכה" nav link |
| `src/components/layout/AdminLayout.tsx` | Modified: add "הגשות" nav link |
| `supabase/migrations/007_completion_rpcs.sql` | `approve_completion` + `reject_completion` Postgres RPCs |

---

## Task 1: Install dependencies and add shadcn Dialog

**Files:**
- Auto-generated: `src/components/ui/dialog.tsx`

- [ ] **Step 1: Install browser-image-compression**

```bash
cd D:/Claude_Projects/family-chores
npm install browser-image-compression
```

Expected: package added to `node_modules` and `package.json`.

- [ ] **Step 2: Add shadcn Dialog component**

```bash
cd D:/Claude_Projects/family-chores
npx shadcn@2.5.0 add dialog
```

Expected: `src/components/ui/dialog.tsx` created.

- [ ] **Step 3: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add package.json package-lock.json src/components/ui/dialog.tsx
git commit -m "feat: add browser-image-compression and shadcn dialog"
```

---

## Task 2: Migration — approve_completion and reject_completion RPCs

**Files:**
- Create: `supabase/migrations/007_completion_rpcs.sql`

These are SECURITY DEFINER Postgres functions that run with postgres superuser privileges, bypassing RLS. `approve_completion` can be called by admins (to approve on behalf of player) or by the completing player themselves (when their trust_level ≥ 4). `reject_completion` is admin-only.

The `is_admin()` helper already exists (defined in `003_rls.sql`).

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/007_completion_rpcs.sql`:

```sql
-- approve_completion: awards coins atomically.
-- Callable by admins OR by the completing player if trust_level >= 4 (self-verification).
CREATE OR REPLACE FUNCTION approve_completion(completion_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_completion  chore_completions%ROWTYPE;
  v_assignment  chore_assignments%ROWTYPE;
  v_chore       chores%ROWTYPE;
  v_trust_level int;
BEGIN
  SELECT * INTO v_completion FROM chore_completions WHERE id = completion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Completion not found';
  END IF;
  IF v_completion.status <> 'pending' THEN
    RAISE EXCEPTION 'Completion is not pending';
  END IF;

  -- Authorization: admin OR the submitting player with trust_level >= 4
  IF NOT is_admin() THEN
    SELECT trust_level INTO v_trust_level FROM profiles WHERE id = auth.uid();
    IF v_completion.completed_by <> auth.uid() OR COALESCE(v_trust_level, 1) < 4 THEN
      RAISE EXCEPTION 'Not authorized to approve this completion';
    END IF;
  END IF;

  SELECT * INTO v_assignment FROM chore_assignments WHERE id = v_completion.chore_assignment_id;
  SELECT * INTO v_chore FROM chores WHERE id = v_assignment.chore_id;

  UPDATE chore_completions
    SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = completion_id;

  UPDATE chore_assignments SET status = 'completed' WHERE id = v_assignment.id;

  INSERT INTO coin_transactions (user_id, family_id, amount, reason, related_entity_id)
    VALUES (v_completion.completed_by, v_chore.family_id, v_chore.coin_value, 'chore_completed', completion_id);

  UPDATE profiles
    SET coin_balance = coin_balance + v_chore.coin_value
    WHERE id = v_completion.completed_by;
END;
$$;

-- reject_completion: admin only. Resets assignment to pending so player can resubmit.
CREATE OR REPLACE FUNCTION reject_completion(completion_id UUID, reason TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    SET status = 'rejected',
        rejection_reason = reason,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = completion_id;

  UPDATE chore_assignments
    SET status = 'pending'
    WHERE id = v_completion.chore_assignment_id;
END;
$$;
```

- [ ] **Step 2: Push migration to Supabase**

```bash
cd D:/Claude_Projects/family-chores
supabase db push
```

Expected: `Applying migration 007_completion_rpcs.sql... done`. The two functions now exist in the database.

- [ ] **Step 3: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add supabase/migrations/007_completion_rpcs.sql
git commit -m "feat: add approve_completion and reject_completion RPCs"
```

---

## Task 3: Extend Supabase test mock with rpc and storage

**Files:**
- Modify: `src/test/mocks/supabase.ts`
- Modify: `src/test/setup.ts`

The current mock only covers `auth` and `from`. Plan 3 tests need `supabase.rpc(...)` and `supabase.storage.from(...)`.

- [ ] **Step 1: Update `src/test/setup.ts`**

Add a `URL.createObjectURL` stub (needed by CompletionPage which calls it for image preview):

```typescript
import '@testing-library/jest-dom'

// JSDOM does not implement URL.createObjectURL — stub it for CompletionPage tests
globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock')
globalThis.URL.revokeObjectURL = vi.fn()
```

Wait — `vi` is not in scope unless imported. `setup.ts` runs before tests but outside of a test file scope. Add the import:

```typescript
import '@testing-library/jest-dom'
import { vi } from 'vitest'

globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock')
globalThis.URL.revokeObjectURL = vi.fn()
```

- [ ] **Step 2: Replace `src/test/mocks/supabase.ts`**

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
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSignInWithPassword: vi.fn(),
  mockSignOut: vi.fn(),
  mockOnAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockStorageFrom: vi.fn(),
}))

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
}
```

- [ ] **Step 3: Run all existing tests to verify nothing broke**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run
```

Expected: all tests still PASS (the mock additions are additive).

- [ ] **Step 4: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add src/test/mocks/supabase.ts src/test/setup.ts
git commit -m "test: add rpc and storage mocks; stub URL.createObjectURL"
```

---

## Task 4: Utility functions — weekStart and photoUtils (TDD)

**Files:**
- Create: `src/lib/weekStart.ts`
- Create: `src/lib/photoUtils.ts`
- Create: `src/lib/__tests__/weekStart.test.ts`
- Create: `src/lib/__tests__/photoUtils.test.ts`

The week runs Sunday–Saturday (Israeli standard). `getCurrentWeekStart` returns the Sunday of the current week as `'YYYY-MM-DD'` in UTC, so results are consistent regardless of server timezone.

- [ ] **Step 1: Write failing tests for weekStart**

Create `src/lib/__tests__/weekStart.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getCurrentWeekStart } from '../weekStart'

describe('getCurrentWeekStart', () => {
  afterEach(() => vi.useRealTimers())

  it('returns the Sunday of the week when called on Wednesday', () => {
    // 2026-04-08 is a Wednesday (UTC); 2026-04-05 is the Sunday
    vi.setSystemTime(new Date('2026-04-08T12:00:00Z'))
    expect(getCurrentWeekStart()).toBe('2026-04-05')
  })

  it('returns the same day when called on Sunday', () => {
    vi.setSystemTime(new Date('2026-04-05T10:00:00Z'))
    expect(getCurrentWeekStart()).toBe('2026-04-05')
  })

  it('returns the preceding Sunday when called on Saturday', () => {
    // 2026-04-11 is Saturday, preceding Sunday is 2026-04-05
    vi.setSystemTime(new Date('2026-04-11T20:00:00Z'))
    expect(getCurrentWeekStart()).toBe('2026-04-05')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/lib/__tests__/weekStart.test.ts
```

Expected: FAIL — `weekStart.ts` does not exist.

- [ ] **Step 3: Create `src/lib/weekStart.ts`**

```typescript
export function getCurrentWeekStart(): string {
  const now = new Date()
  const utcDay = now.getUTCDay() // 0 = Sunday
  const start = new Date(now)
  start.setUTCDate(now.getUTCDate() - utcDay)
  start.setUTCHours(0, 0, 0, 0)
  return start.toISOString().split('T')[0]
}
```

- [ ] **Step 4: Run to verify weekStart tests pass**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/lib/__tests__/weekStart.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Write failing tests for photoUtils**

Create `src/lib/__tests__/photoUtils.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('browser-image-compression', () => ({
  default: vi.fn(async (file: File) => new File([file], 'compressed.webp', { type: 'image/webp' })),
}))

import imageCompression from 'browser-image-compression'
import { compressPhoto } from '../photoUtils'

describe('compressPhoto', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls imageCompression with the correct options', async () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
    await compressPhoto(file)
    expect(imageCompression).toHaveBeenCalledWith(file, expect.objectContaining({
      maxSizeMB: 0.2,
      maxWidthOrHeight: 1280,
      fileType: 'image/webp',
      initialQuality: 0.75,
    }))
  })

  it('returns the compressed file', async () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressPhoto(file)
    expect(result).toBeInstanceOf(File)
    expect(result.type).toBe('image/webp')
  })
})
```

- [ ] **Step 6: Run to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/lib/__tests__/photoUtils.test.ts
```

Expected: FAIL — `photoUtils.ts` does not exist.

- [ ] **Step 7: Create `src/lib/photoUtils.ts`**

```typescript
import imageCompression from 'browser-image-compression'

export async function compressPhoto(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 0.2,
    maxWidthOrHeight: 1280,
    useWebWorker: true,
    fileType: 'image/webp',
    initialQuality: 0.75,
  })
}
```

- [ ] **Step 8: Run all utility tests**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/lib/__tests__/
```

Expected: 5 tests PASS (3 weekStart + 2 photoUtils).

- [ ] **Step 9: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add src/lib/weekStart.ts src/lib/photoUtils.ts src/lib/__tests__/
git commit -m "feat: add weekStart and photoUtils utility functions"
```

---

## Task 5: useChoreAssignments hook (TDD)

**Files:**
- Create: `src/hooks/__tests__/useChoreAssignments.test.ts`
- Create: `src/hooks/useChoreAssignments.ts`

Fetches the current week's non-archived assignments for the given `userId`. Uses `mountedRef` to prevent stale state updates. Skips the query when `userId` is undefined (loading state before profile is available).

- [ ] **Step 1: Write failing tests**

Create `src/hooks/__tests__/useChoreAssignments.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useChoreAssignments } from '../useChoreAssignments'

vi.mock('../../lib/weekStart', () => ({
  getCurrentWeekStart: vi.fn(() => '2026-04-05'),
}))

const fakeAssignment = {
  id: 'a1',
  chore_id: 'c1',
  user_id: 'u1',
  week_start: '2026-04-05',
  calendar_day: null,
  calendar_slot: null,
  reminder_enabled: false,
  status: 'pending' as const,
  archived: false,
  created_at: '2026-04-05T00:00:00Z',
  updated_at: '2026-04-05T00:00:00Z',
}

// Builds a mock for: .from(...).select('*').eq(...).eq(...).eq(...).order(...)
function makeChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.order = vi.fn().mockResolvedValue(resolvedValue)
  return chain
}

describe('useChoreAssignments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts with loading=true', () => {
    mockFrom.mockReturnValue(makeChain(new Promise(() => {})))
    const { result } = renderHook(() => useChoreAssignments('u1'))
    expect(result.current.loading).toBe(true)
  })

  it('returns assignments on success', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [fakeAssignment], error: null }))
    const { result } = renderHook(() => useChoreAssignments('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.assignments).toHaveLength(1)
    expect(result.current.assignments[0].id).toBe('a1')
  })

  it('returns error string on query failure', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'DB error' } }))
    const { result } = renderHook(() => useChoreAssignments('u1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('DB error')
    expect(result.current.assignments).toHaveLength(0)
  })

  it('does not query Supabase when userId is undefined', async () => {
    const { result } = renderHook(() => useChoreAssignments(undefined))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/hooks/__tests__/useChoreAssignments.test.ts
```

Expected: FAIL — `useChoreAssignments.ts` does not exist.

- [ ] **Step 3: Create `src/hooks/useChoreAssignments.ts`**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentWeekStart } from '../lib/weekStart'
import type { ChoreAssignment } from '../types/database'

export interface UseChoreAssignmentsResult {
  assignments: ChoreAssignment[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useChoreAssignments(userId: string | undefined): UseChoreAssignmentsResult {
  const [assignments, setAssignments] = useState<ChoreAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchAssignments = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const weekStart = getCurrentWeekStart()
    const { data, error } = await supabase
      .from('chore_assignments')
      .select('*')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .eq('archived', false)
      .order('created_at', { ascending: true })
    if (!mountedRef.current) return
    if (error) { setError(error.message) } else { setAssignments((data as ChoreAssignment[]) ?? []) }
    setLoading(false)
  }, [userId])

  useEffect(() => { fetchAssignments() }, [fetchAssignments])

  return { assignments, loading, error, refetch: fetchAssignments }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/hooks/__tests__/useChoreAssignments.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add src/hooks/useChoreAssignments.ts src/hooks/__tests__/useChoreAssignments.test.ts
git commit -m "feat: add useChoreAssignments hook"
```

---

## Task 6: usePendingCompletions hook (TDD)

**Files:**
- Create: `src/hooks/__tests__/usePendingCompletions.test.ts`
- Create: `src/hooks/usePendingCompletions.ts`

Admin hook. Queries `chore_completions` with status `pending`, joining to `chore_assignments → chores` (for title and coin value) and `profiles` (for player name). Uses `mountedRef` like other hooks.

- [ ] **Step 1: Write failing tests**

Create `src/hooks/__tests__/usePendingCompletions.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { usePendingCompletions } from '../usePendingCompletions'

const fakeCompletion = {
  id: 'comp1',
  chore_assignment_id: 'a1',
  completed_by: 'p1',
  photo_url: 'p1/photo.webp',
  status: 'pending',
  completed_at: '2026-04-08T10:00:00Z',
  chore_assignments: {
    chore_id: 'c1',
    chores: { title: 'כלי מטבח', coin_value: 10 },
  },
  profiles: { name: 'דנה' },
}

// Builds a mock for: .from(...).select(...).eq('status', 'pending').order(...)
function makeChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.order = vi.fn().mockResolvedValue(resolvedValue)
  return chain
}

describe('usePendingCompletions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts with loading=true', () => {
    mockFrom.mockReturnValue(makeChain(new Promise(() => {})))
    const { result } = renderHook(() => usePendingCompletions())
    expect(result.current.loading).toBe(true)
  })

  it('returns completions on success', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [fakeCompletion], error: null }))
    const { result } = renderHook(() => usePendingCompletions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.completions).toHaveLength(1)
    expect(result.current.completions[0].id).toBe('comp1')
    expect(result.current.completions[0].chore_assignments.chores.title).toBe('כלי מטבח')
    expect(result.current.completions[0].profiles.name).toBe('דנה')
  })

  it('returns error string on query failure', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'query failed' } }))
    const { result } = renderHook(() => usePendingCompletions())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('query failed')
    expect(result.current.completions).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/hooks/__tests__/usePendingCompletions.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `src/hooks/usePendingCompletions.ts`**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

export interface CompletionWithDetails {
  id: string
  chore_assignment_id: string
  completed_by: string
  photo_url: string | null
  status: 'pending' | 'approved' | 'rejected'
  completed_at: string
  chore_assignments: {
    chore_id: string
    chores: { title: string; coin_value: number }
  }
  profiles: { name: string }
}

export interface UsePendingCompletionsResult {
  completions: CompletionWithDetails[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function usePendingCompletions(): UsePendingCompletionsResult {
  const [completions, setCompletions] = useState<CompletionWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchCompletions = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('chore_completions')
      .select(`
        id,
        chore_assignment_id,
        completed_by,
        photo_url,
        status,
        completed_at,
        chore_assignments!inner(chore_id, chores!inner(title, coin_value)),
        profiles!completed_by(name)
      `)
      .eq('status', 'pending')
      .order('completed_at', { ascending: true })
    if (!mountedRef.current) return
    if (error) { setError(error.message) } else { setCompletions((data as CompletionWithDetails[]) ?? []) }
    setLoading(false)
  }, [])

  useEffect(() => { fetchCompletions() }, [fetchCompletions])

  return { completions, loading, error, refetch: fetchCompletions }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/hooks/__tests__/usePendingCompletions.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add src/hooks/usePendingCompletions.ts src/hooks/__tests__/usePendingCompletions.test.ts
git commit -m "feat: add usePendingCompletions hook"
```

---

## Task 7: Player Dashboard redesign (TDD)

**Files:**
- Modify: `src/pages/player/PlayerDashboard.tsx`
- Create: `src/pages/player/__tests__/PlayerDashboard.test.tsx`

The header already shows coin balance (via `PlayerLayout`). This page shows the player's current-week assignments and a link to the chore pool. Uses `useChoreAssignments` and `useChores` (to resolve chore title/coins from the assignment's `chore_id`).

Assignment status labels and badge variants:

| status | Hebrew label | Badge variant |
|--------|-------------|---------------|
| pending | ממתין | secondary |
| in_progress | בביצוע | default |
| completed | הושלם | secondary |
| overdue | באיחור | destructive |
| failed | נכשל | destructive |

A "סיימתי" link-button is shown for `pending` and `in_progress` assignments, linking to `/player/chores/{assignmentId}/complete`.

- [ ] **Step 1: Write failing tests**

Create `src/pages/player/__tests__/PlayerDashboard.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../hooks/useChoreAssignments', () => ({
  useChoreAssignments: vi.fn(() => ({ assignments: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', name: 'דנה', coin_balance: 50, trust_level: 2 } }),
}))

import { useChoreAssignments } from '../../../hooks/useChoreAssignments'
import { useChores } from '../../../hooks/useChores'
import PlayerDashboard from '../PlayerDashboard'

const mockUseChoreAssignments = vi.mocked(useChoreAssignments)
const mockUseChores = vi.mocked(useChores)

const fakeChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', coin_value: 10,
  difficulty: 'easy' as const, assigned_to: null, is_recurring: false,
  status: 'active' as const, description: null, proposed_by: null,
  approved_by: null, due_date: null, last_traded_price: null,
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

const fakeAssignment = {
  id: 'a1', chore_id: 'c1', user_id: 'p1', week_start: '2026-04-05',
  calendar_day: null, calendar_slot: null, reminder_enabled: false,
  status: 'pending' as const, archived: false,
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

function renderDashboard() {
  return render(<MemoryRouter><PlayerDashboard /></MemoryRouter>)
}

describe('PlayerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  })

  it('shows loading spinner while loading', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: true, error: null, refetch: vi.fn() })
    renderDashboard()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no assignments', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    expect(screen.getByText(/אין משימות השבוע/)).toBeInTheDocument()
  })

  it('shows assignment with chore title and coin value', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [fakeAssignment], loading: false, error: null, refetch: vi.fn() })
    mockUseChores.mockReturnValue({ chores: [fakeChore], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
    expect(screen.getByText(/10 מטבעות/)).toBeInTheDocument()
  })

  it('shows "סיימתי" link for pending assignment', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [fakeAssignment], loading: false, error: null, refetch: vi.fn() })
    mockUseChores.mockReturnValue({ chores: [fakeChore], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    const link = screen.getByRole('link', { name: 'סיימתי' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/player/chores/a1/complete')
  })

  it('shows "בחר משימה" link to the chore pool', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    expect(screen.getByRole('link', { name: 'בחר משימה' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/pages/player/__tests__/PlayerDashboard.test.tsx
```

Expected: FAIL — the current PlayerDashboard is a placeholder.

- [ ] **Step 3: Replace `src/pages/player/PlayerDashboard.tsx`**

```typescript
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useChoreAssignments } from '../../hooks/useChoreAssignments'
import { useChores } from '../../hooks/useChores'
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

  function choreTitle(choreId: string): string {
    return chores.find(c => c.id === choreId)?.title ?? 'משימה'
  }

  function choreCoins(choreId: string): number {
    return chores.find(c => c.id === choreId)?.coin_value ?? 0
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">המשימות שלי</h1>
        <Button asChild>
          <Link to="/player/pool">בחר משימה</Link>
        </Button>
      </div>

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

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/pages/player/__tests__/PlayerDashboard.test.tsx
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add src/pages/player/PlayerDashboard.tsx src/pages/player/__tests__/PlayerDashboard.test.tsx
git commit -m "feat: redesign player dashboard with weekly assignments"
```

---

## Task 8: Chore Pool page (TDD)

**Files:**
- Create: `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx`
- Create: `src/pages/player/chores/ChorePoolPage.tsx`

Route: `/player/pool`. Shows active open-pool chores (`status === 'active' && assigned_to === null`) that the current user has not already picked up this week (exclude chore IDs already in their `useChoreAssignments` results). Pick-up inserts a row into `chore_assignments`.

- [ ] **Step 1: Write failing tests**

Create `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

vi.mock('../../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../hooks/useChoreAssignments', () => ({
  useChoreAssignments: vi.fn(() => ({ assignments: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', family_id: 'f1' } }),
}))
vi.mock('../../../../lib/weekStart', () => ({
  getCurrentWeekStart: vi.fn(() => '2026-04-05'),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import { useChores } from '../../../../hooks/useChores'
import { useChoreAssignments } from '../../../../hooks/useChoreAssignments'
import ChorePoolPage from '../ChorePoolPage'

const mockUseChores = vi.mocked(useChores)
const mockUseChoreAssignments = vi.mocked(useChoreAssignments)

const openChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', coin_value: 10,
  difficulty: 'easy' as const, assigned_to: null, is_recurring: false,
  status: 'active' as const, description: null, proposed_by: null,
  approved_by: null, due_date: null, last_traded_price: null,
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

function renderPoolPage() {
  return render(<MemoryRouter><ChorePoolPage /></MemoryRouter>)
}

describe('ChorePoolPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
  })

  it('shows loading spinner while loading', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: true, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no open chores', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('אין משימות זמינות כרגע.')).toBeInTheDocument()
  })

  it('shows open chore with title, coin value, and difficulty', () => {
    mockUseChores.mockReturnValue({ chores: [openChore], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
    expect(screen.getByText(/10 מטבעות/)).toBeInTheDocument()
    expect(screen.getByText('קל')).toBeInTheDocument()
  })

  it('hides chores the player already picked up this week', () => {
    const existingAssignment = {
      id: 'a1', chore_id: 'c1', user_id: 'p1', week_start: '2026-04-05',
      calendar_day: null, calendar_slot: null, reminder_enabled: false,
      status: 'pending' as const, archived: false,
      created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
    }
    mockUseChores.mockReturnValue({ chores: [openChore], loading: false, error: null, refetch: vi.fn() })
    mockUseChoreAssignments.mockReturnValue({ assignments: [existingAssignment], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.queryByText('כלי מטבח')).not.toBeInTheDocument()
  })

  it('picks up chore on click and navigates to /player', async () => {
    mockUseChores.mockReturnValue({ chores: [openChore], loading: false, error: null, refetch: vi.fn() })
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: 'קח משימה' }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/player'))
  })

  it('shows error when pick up fails', async () => {
    mockUseChores.mockReturnValue({ chores: [openChore], loading: false, error: null, refetch: vi.fn() })
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: 'fail' } }) })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: 'קח משימה' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בבחירת המשימה'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/pages/player/chores/__tests__/ChorePoolPage.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `src/pages/player/chores/ChorePoolPage.tsx`**

```typescript
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useChores } from '../../../hooks/useChores'
import { useChoreAssignments } from '../../../hooks/useChoreAssignments'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { getCurrentWeekStart } from '../../../lib/weekStart'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent } from '../../../components/ui/card'
import type { ChoreDifficulty } from '../../../types/database'

const difficultyLabel: Record<ChoreDifficulty, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
}

export default function ChorePoolPage() {
  const { profile } = useAuth()
  const { chores, loading: choresLoading } = useChores()
  const { assignments } = useChoreAssignments(profile?.id)
  const navigate = useNavigate()
  const [pickingId, setPickingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const assignedChoreIds = new Set(assignments.map(a => a.chore_id))
  const poolChores = chores.filter(
    c => c.status === 'active' && c.assigned_to === null && !assignedChoreIds.has(c.id)
  )

  async function pickUpChore(choreId: string) {
    if (!profile) return
    setPickingId(choreId)
    setError(null)
    const { error } = await supabase.from('chore_assignments').insert({
      chore_id: choreId,
      user_id: profile.id,
      week_start: getCurrentWeekStart(),
      status: 'pending',
      archived: false,
      reminder_enabled: false,
    })
    setPickingId(null)
    if (error) { setError('שגיאה בבחירת המשימה') } else { navigate('/player') }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3 mb-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/player">← חזרה</Link>
        </Button>
        <h1 className="text-2xl font-bold">בחר משימה</h1>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {choresLoading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : poolChores.length === 0 ? (
        <p className="text-muted-foreground">אין משימות זמינות כרגע.</p>
      ) : (
        <div className="space-y-3">
          {poolChores.map(chore => (
            <Card key={chore.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{chore.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-muted-foreground">{chore.coin_value} מטבעות</span>
                    <Badge variant="secondary">{difficultyLabel[chore.difficulty]}</Badge>
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={pickingId === chore.id}
                  onClick={() => pickUpChore(chore.id)}
                >
                  {pickingId === chore.id ? 'שומר...' : 'קח משימה'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/pages/player/chores/__tests__/ChorePoolPage.test.tsx
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add src/pages/player/chores/ChorePoolPage.tsx src/pages/player/chores/__tests__/ChorePoolPage.test.tsx
git commit -m "feat: add chore pool page for picking up open chores"
```

---

## Task 9: Completion submission page (TDD)

**Files:**
- Create: `src/pages/player/chores/__tests__/CompletionPage.test.tsx`
- Create: `src/pages/player/chores/CompletionPage.tsx`

Route: `/player/chores/:assignmentId/complete`. Player picks a photo file → client compresses it (via `compressPhoto`) → uploads to `completion-photos/{userId}/{uuid}.webp` → inserts a `chore_completions` row with `status='pending'` → if `profile.trust_level >= 4`, immediately calls `approve_completion` RPC (self-verification) → navigates to `/player`.

- [ ] **Step 1: Write failing tests**

Create `src/pages/player/chores/__tests__/CompletionPage.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom, mockRpc, mockStorageFrom } from '../../../../test/mocks/supabase'

vi.mock('../../../../lib/photoUtils', () => ({
  compressPhoto: vi.fn(async (f: File) => f),
}))

let mockTrustLevel = 1
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', family_id: 'f1', trust_level: mockTrustLevel } }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import CompletionPage from '../CompletionPage'

function renderPage(assignmentId = 'a1') {
  return render(
    <MemoryRouter initialEntries={[`/player/chores/${assignmentId}/complete`]}>
      <Routes>
        <Route path="/player/chores/:assignmentId/complete" element={<CompletionPage />} />
      </Routes>
    </MemoryRouter>
  )
}

// Returns a mock for: supabase.storage.from('completion-photos')
function makeStorageMock(uploadResult: unknown) {
  return {
    upload: vi.fn().mockResolvedValue(uploadResult),
    createSignedUrl: vi.fn(),
    remove: vi.fn(),
  }
}

// Returns a mock for the insert().select().single() chain
function makeInsertChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {}
  chain.insert = vi.fn().mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue(resolvedValue)
  return chain
}

describe('CompletionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTrustLevel = 1
  })

  it('renders file input and disabled submit button', () => {
    renderPage()
    expect(screen.getByLabelText('תמונת הוכחה')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שלח הוכחה' })).toBeDisabled()
  })

  it('enables submit button after file is selected', async () => {
    renderPage()
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    expect(screen.getByRole('button', { name: 'שלח הוכחה' })).toBeEnabled()
  })

  it('uploads photo, creates completion record, and navigates to /player', async () => {
    mockStorageFrom.mockReturnValue(makeStorageMock({ error: null }))
    mockFrom.mockReturnValue(makeInsertChain({ data: { id: 'comp1' }, error: null }))
    renderPage()

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/player'))
  })

  it('shows error when photo upload fails', async () => {
    mockStorageFrom.mockReturnValue(makeStorageMock({ error: { message: 'upload failed' } }))
    renderPage()

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בהעלאת התמונה')
    )
  })

  it('shows error when insert fails', async () => {
    mockStorageFrom.mockReturnValue(makeStorageMock({ error: null }))
    mockFrom.mockReturnValue(makeInsertChain({ data: null, error: { message: 'db error' } }))
    renderPage()

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשמירת ההשלמה')
    )
  })

  it('calls approve_completion RPC for trust level 4+ players', async () => {
    mockTrustLevel = 4
    mockStorageFrom.mockReturnValue(makeStorageMock({ error: null }))
    mockFrom.mockReturnValue(makeInsertChain({ data: { id: 'comp1' }, error: null }))
    mockRpc.mockResolvedValue({ error: null })
    renderPage()

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('approve_completion', { completion_id: 'comp1' })
    )
  })

  it('does NOT call approve_completion RPC for trust level 1 players', async () => {
    mockTrustLevel = 1
    mockStorageFrom.mockReturnValue(makeStorageMock({ error: null }))
    mockFrom.mockReturnValue(makeInsertChain({ data: { id: 'comp1' }, error: null }))
    renderPage()

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/player'))
    expect(mockRpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/pages/player/chores/__tests__/CompletionPage.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `src/pages/player/chores/CompletionPage.tsx`**

```typescript
import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { compressPhoto } from '../../../lib/photoUtils'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'

export default function CompletionPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setPreview(URL.createObjectURL(file))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedFile || !profile || !assignmentId) return
    setError(null)
    setSubmitting(true)
    try {
      const compressed = await compressPhoto(selectedFile)
      const filePath = `${profile.id}/${crypto.randomUUID()}.webp`

      const { error: uploadError } = await supabase.storage
        .from('completion-photos')
        .upload(filePath, compressed)
      if (uploadError) { setError('שגיאה בהעלאת התמונה'); return }

      const { data: completion, error: insertError } = await supabase
        .from('chore_completions')
        .insert({
          chore_assignment_id: assignmentId,
          completed_by: profile.id,
          photo_url: filePath,
          status: 'pending',
        })
        .select('id')
        .single()
      if (insertError || !completion) { setError('שגיאה בשמירת ההשלמה'); return }

      if ((profile.trust_level ?? 1) >= 4) {
        const { error: rpcError } = await supabase.rpc('approve_completion', {
          completion_id: completion.id,
        })
        if (rpcError) { setError('שגיאה בקבלת המטבעות'); return }
      }

      navigate('/player')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-lg" dir="rtl">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/player">← חזרה</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>הגשת הוכחת ביצוע</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="photo" className="text-sm font-medium">
                תמונת הוכחה
              </label>
              <input
                id="photo"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="block w-full text-sm"
                required
              />
            </div>

            {preview && (
              <img
                src={preview}
                alt="תצוגה מקדימה"
                className="w-full max-h-64 object-cover rounded"
              />
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={submitting || !selectedFile}>
              {submitting ? 'שולח...' : 'שלח הוכחה'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/pages/player/chores/__tests__/CompletionPage.test.tsx
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add src/pages/player/chores/CompletionPage.tsx src/pages/player/chores/__tests__/CompletionPage.test.tsx
git commit -m "feat: add photo submission page with EXIF-stripped compression"
```

---

## Task 10: Admin Completions Review page (TDD)

**Files:**
- Create: `src/pages/admin/completions/__tests__/CompletionsPage.test.tsx`
- Create: `src/pages/admin/completions/CompletionsPage.tsx`

Route: `/admin/completions`. Lists pending completions from `usePendingCompletions`. Each row shows chore title, player name, and submission date. Three actions: "צפה בתמונה" (generates a 1-hour signed URL, opens in new tab), "אשר" (calls `approve_completion` RPC + deletes photo + refetches), "דחה" (opens Dialog for rejection reason → calls `reject_completion` RPC + deletes photo + refetches).

- [ ] **Step 1: Write failing tests**

Create `src/pages/admin/completions/__tests__/CompletionsPage.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockRpc, mockStorageFrom } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/usePendingCompletions', () => ({
  usePendingCompletions: vi.fn(() => ({
    completions: [],
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', family_id: 'f1' } }),
}))

import { usePendingCompletions } from '../../../../hooks/usePendingCompletions'
import CompletionsPage from '../CompletionsPage'

const mockUsePendingCompletions = vi.mocked(usePendingCompletions)

const fakeCompletion = {
  id: 'comp1',
  chore_assignment_id: 'a1',
  completed_by: 'p1',
  photo_url: 'p1/photo.webp',
  status: 'pending' as const,
  completed_at: '2026-04-08T10:00:00Z',
  chore_assignments: {
    chore_id: 'c1',
    chores: { title: 'כלי מטבח', coin_value: 10 },
  },
  profiles: { name: 'דנה' },
}

function renderPage() {
  return render(<MemoryRouter><CompletionsPage /></MemoryRouter>)
}

describe('CompletionsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading spinner while loading', () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: true, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no pending completions', () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('אין הגשות ממתינות לאישור.')).toBeInTheDocument()
  })

  it('shows completion with chore title, player name, and action buttons', () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [fakeCompletion], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
    expect(screen.getByText(/דנה/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'אשר' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'דחה' })).toBeInTheDocument()
  })

  it('approve calls rpc, deletes photo, and refetches', async () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [fakeCompletion], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null })
    mockStorageFrom.mockReturnValue({ remove: vi.fn().mockResolvedValue({}), createSignedUrl: vi.fn() })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('approve_completion', { completion_id: 'comp1' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('reject opens dialog; submitting calls rpc and refetches', async () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [fakeCompletion], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null })
    mockStorageFrom.mockReturnValue({ remove: vi.fn().mockResolvedValue({}), createSignedUrl: vi.fn() })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
    expect(screen.getByLabelText('הסבר לשחקן')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('הסבר לשחקן'), 'תמונה לא ברורה')
    await userEvent.click(screen.getByRole('button', { name: 'דחה הגשה' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('reject_completion', {
        completion_id: 'comp1',
        reason: 'תמונה לא ברורה',
      })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows error when approve fails', async () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [fakeCompletion], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'DB error' } })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('שגיאה באישור ההגשה'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/pages/admin/completions/__tests__/CompletionsPage.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `src/pages/admin/completions/CompletionsPage.tsx`**

```typescript
import { useState } from 'react'
import { usePendingCompletions, type CompletionWithDetails } from '../../../hooks/usePendingCompletions'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog'
import { Textarea } from '../../../components/ui/textarea'
import { Label } from '../../../components/ui/label'

export default function CompletionsPage() {
  const { completions, loading, refetch } = usePendingCompletions()
  const [actionError, setActionError] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<CompletionWithDetails | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')

  async function deletePhoto(photoUrl: string) {
    await supabase.storage.from('completion-photos').remove([photoUrl])
  }

  async function viewPhoto(photoUrl: string) {
    const { data } = await supabase.storage
      .from('completion-photos')
      .createSignedUrl(photoUrl, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function approve(completion: CompletionWithDetails) {
    setActionError(null)
    const { error } = await supabase.rpc('approve_completion', { completion_id: completion.id })
    if (error) { setActionError('שגיאה באישור ההגשה'); return }
    if (completion.photo_url) await deletePhoto(completion.photo_url)
    refetch()
  }

  async function confirmReject() {
    if (!rejectTarget || !rejectionReason.trim()) return
    setActionError(null)
    const { error } = await supabase.rpc('reject_completion', {
      completion_id: rejectTarget.id,
      reason: rejectionReason.trim(),
    })
    if (error) { setActionError('שגיאה בדחיית ההגשה'); setRejectTarget(null); return }
    if (rejectTarget.photo_url) await deletePhoto(rejectTarget.photo_url)
    setRejectTarget(null)
    setRejectionReason('')
    refetch()
  }

  return (
    <div className="space-y-6" dir="rtl">
      <h1 className="text-2xl font-bold">אישור הגשות</h1>

      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      {loading ? (
        <div role="status" className="text-center py-8 text-muted-foreground">טוען...</div>
      ) : completions.length === 0 ? (
        <p className="text-muted-foreground">אין הגשות ממתינות לאישור.</p>
      ) : (
        <div className="space-y-3">
          {completions.map(c => (
            <Card key={c.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{c.chore_assignments.chores.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {c.profiles.name} · {new Date(c.completed_at).toLocaleDateString('he-IL')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {c.photo_url && (
                      <Button variant="outline" size="sm" onClick={() => viewPhoto(c.photo_url!)}>
                        צפה בתמונה
                      </Button>
                    )}
                    <Button size="sm" onClick={() => approve(c)}>אשר</Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => { setRejectTarget(c); setRejectionReason('') }}
                    >
                      דחה
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={open => { if (!open) setRejectTarget(null) }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>סיבת דחייה</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rejectionReason">הסבר לשחקן</Label>
            <Textarea
              id="rejectionReason"
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              rows={3}
              placeholder="למשל: התמונה לא ברורה מספיק..."
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectTarget(null)}>ביטול</Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={!rejectionReason.trim()}
            >
              דחה הגשה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run -- src/pages/admin/completions/__tests__/CompletionsPage.test.tsx
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add src/pages/admin/completions/CompletionsPage.tsx src/pages/admin/completions/__tests__/CompletionsPage.test.tsx
git commit -m "feat: add admin completions review page with approve/reject"
```

---

## Task 11: Wire routes and nav links

**Files:**
- Modify: `src/router.tsx`
- Modify: `src/components/layout/PlayerLayout.tsx`
- Modify: `src/components/layout/AdminLayout.tsx`

- [ ] **Step 1: Replace `src/router.tsx`**

```typescript
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import AdminDashboard from './pages/admin/AdminDashboard'
import ChoresPage from './pages/admin/chores/ChoresPage'
import ChoreFormPage from './pages/admin/chores/ChoreFormPage'
import CompletionsPage from './pages/admin/completions/CompletionsPage'
import PlayerDashboard from './pages/player/PlayerDashboard'
import ChorePoolPage from './pages/player/chores/ChorePoolPage'
import CompletionPage from './pages/player/chores/CompletionPage'
import AdminLayout from './components/layout/AdminLayout'
import PlayerLayout from './components/layout/PlayerLayout'

function RootRedirect() {
  const { profile, session, loading } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  return <Navigate to={profile?.role === 'admin' ? '/admin' : '/player'} replace />
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/admin',
    element: (
      <ProtectedRoute requiredRole="admin">
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: 'chores', element: <ChoresPage /> },
      { path: 'chores/new', element: <ChoreFormPage /> },
      { path: 'chores/:id/edit', element: <ChoreFormPage /> },
      { path: 'completions', element: <CompletionsPage /> },
    ],
  },
  {
    path: '/player',
    element: (
      <ProtectedRoute requiredRole="player">
        <PlayerLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <PlayerDashboard /> },
      { path: 'pool', element: <ChorePoolPage /> },
      { path: 'chores/:assignmentId/complete', element: <CompletionPage /> },
    ],
  },
  {
    path: '/',
    element: <RootRedirect />,
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
])
```

- [ ] **Step 2: Update `src/components/layout/PlayerLayout.tsx`**

Add a "בריכה" NavLink to the nav section (after the existing "הדשבורד שלי" link):

```tsx
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
</nav>
```

- [ ] **Step 3: Update `src/components/layout/AdminLayout.tsx`**

Add a "הגשות" NavLink after the existing "משימות" link:

```tsx
<NavLink
  to="/admin/completions"
  className={({ isActive }) =>
    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
  }
>
  הגשות
</NavLink>
```

- [ ] **Step 4: Run all tests**

```bash
cd D:/Claude_Projects/family-chores && npm run test:run
```

Expected: all tests PASS (no regressions).

- [ ] **Step 5: TypeScript check**

```bash
cd D:/Claude_Projects/family-chores && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd D:/Claude_Projects/family-chores
git add src/router.tsx src/components/layout/PlayerLayout.tsx src/components/layout/AdminLayout.tsx
git commit -m "feat: wire player + admin completion routes and nav links"
```

---

## Self-Review

**Spec section 4.1 coverage:**
- [x] Open-pool chores visible to all players → `ChorePoolPage`
- [x] Players pick up chores (creates ChoreAssignment) → `ChorePoolPage.pickUpChore`
- [x] Recurring chores auto-populate each week → **Out of scope** (Edge Function cron, deferred to Plan 4)

**Spec section 4.2 coverage:**
- [x] Players submit photo proof → `CompletionPage` (compress + upload + insert)
- [x] Trust levels 1–3: admin must approve → `CompletionsPage.approve` calls `approve_completion` RPC
- [x] Trust levels 4–5: self-verification, coins awarded immediately → `CompletionPage` calls `approve_completion` RPC directly
- [x] `approve_completion` atomically awards coins → migration `007_completion_rpcs.sql`
- [x] Rejected completions: admin provides reason, player can resubmit → `CompletionsPage` reject dialog, assignment reset to `pending`
- [ ] Rejected completions notify player → **Out of scope** (Notifications system, deferred to Plan 5)

**Spec section 7.1 (photo security):**
- [x] EXIF stripping via browser-image-compression Canvas re-encoding → `compressPhoto`
- [x] Private bucket with no public URLs → bucket created in `004_storage.sql` (`public: false`)
- [x] Signed URL (1-hour) for admin photo view → `CompletionsPage.viewPhoto`
- [x] Photo deleted after review → `approve` and `confirmReject` call `deletePhoto`
- [ ] Auto-delete unreviewed photos older than 30 days → **Out of scope** (Edge Function cron, deferred to Plan 4)

**Placeholder scan:** None found.

**Type consistency check:**
- `CompletionWithDetails` defined in `usePendingCompletions.ts`, imported into `CompletionsPage.tsx` ✓
- `useChoreAssignments(userId: string | undefined)` — `profile?.id` is `string | undefined` ✓
- `getCurrentWeekStart()` returns `string` used as `.eq('week_start', weekStart)` ✓
- `approve_completion` / `reject_completion` — called via `supabase.rpc(name, args)` matching the SQL function signatures ✓
