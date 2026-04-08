# Chore Management (Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin chore management flow — view all family chores, create/edit/archive chores, and approve or reject kid-proposed chores.

**Architecture:** Admin-only pages under `/admin/chores`, nested inside the existing `AdminLayout` (which renders `<Outlet />`). Two custom React hooks (`useChores`, `useFamilyMembers`) wrap Supabase queries and are reused across pages. Mutations (archive, approve, reject, insert, update) are called inline in page components. Supabase RLS already scopes all queries to the authenticated user's family — no explicit `family_id` filter needed on reads, but `family_id` must be provided on inserts.

**Tech Stack:** React 18, TypeScript 5, Supabase JS v2, shadcn/ui (Button, Badge, Card, Input, Select, Textarea, Separator), React Router v6 nested routes, Vitest + React Testing Library

**Prerequisite:** The authenticated admin must have a non-null `family_id` in the `profiles` table. Without it, chore inserts will fail (`family_id` is `NOT NULL` in the schema). Create the family row and set the admin's `family_id` in Supabase Dashboard if not done already.

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/hooks/useChores.ts` | Fetch all non-archived chores for the family; expose `refetch` |
| `src/hooks/useFamilyMembers.ts` | Fetch all profiles for the family (name lookup + assignment dropdown) |
| `src/hooks/__tests__/useChores.test.ts` | Tests for useChores |
| `src/hooks/__tests__/useFamilyMembers.test.ts` | Tests for useFamilyMembers |
| `src/pages/admin/chores/ChoresPage.tsx` | List: active chores + pending proposals with archive/approve/reject |
| `src/pages/admin/chores/ChoreFormPage.tsx` | Create and edit chore form (shared, mode from URL param) |
| `src/pages/admin/chores/__tests__/ChoresPage.test.tsx` | Tests for ChoresPage |
| `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx` | Tests for ChoreFormPage |
| `src/router.tsx` | Modified: add `/admin/chores`, `/admin/chores/new`, `/admin/chores/:id/edit` |
| `src/components/layout/AdminLayout.tsx` | Modified: add "משימות" nav link |
| `src/pages/admin/AdminDashboard.tsx` | Modified: add pending-proposals count card + link to chores |

---

## Task 1: Install additional shadcn/ui components

**Files:**
- Auto-generated: `src/components/ui/select.tsx`
- Auto-generated: `src/components/ui/textarea.tsx`
- Auto-generated: `src/components/ui/separator.tsx`

- [ ] **Step 1: Add shadcn components**

```bash
cd D:/Claude_Projects/family-chores
npx shadcn@2.5.0 add select textarea separator
```

Expected: three new files created under `src/components/ui/`.

- [ ] **Step 2: Verify**

```bash
ls src/components/ui/
```

Expected: `select.tsx`, `textarea.tsx`, `separator.tsx` present alongside existing components.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/
git commit -m "feat: add select, textarea, and separator shadcn components"
```

---

## Task 2: useChores and useFamilyMembers hooks (TDD)

**Files:**
- Create: `src/hooks/__tests__/useChores.test.ts`
- Create: `src/hooks/__tests__/useFamilyMembers.test.ts`
- Create: `src/hooks/useChores.ts`
- Create: `src/hooks/useFamilyMembers.ts`

- [ ] **Step 1: Write failing tests for useChores**

Create `src/hooks/__tests__/useChores.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useChores } from '../useChores'

const fakeChore = {
  id: 'c1',
  family_id: 'f1',
  title: 'כלי מטבח',
  description: null,
  coin_value: 10,
  difficulty: 'easy' as const,
  assigned_to: null,
  is_recurring: false,
  status: 'active' as const,
  proposed_by: null,
  approved_by: null,
  due_date: null,
  last_traded_price: null,
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

describe('useChores', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useChores())
    expect(result.current.loading).toBe(true)
    expect(result.current.chores).toEqual([])
  })

  it('returns chores after successful fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeChore], error: null }))
    const { result } = renderHook(() => useChores())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.chores).toEqual([fakeChore])
    expect(result.current.error).toBeNull()
  })

  it('sets error message on failed fetch', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: null, error: { message: 'שגיאת שרת' } }))
    const { result } = renderHook(() => useChores())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('שגיאת שרת')
    expect(result.current.chores).toEqual([])
  })

  it('refetch re-queries and updates chores', async () => {
    mockFrom.mockReturnValue(makeFromMock({ data: [fakeChore], error: null }))
    const { result } = renderHook(() => useChores())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const updatedChore = { ...fakeChore, title: 'כיבוי אורות' }
    mockFrom.mockReturnValue(makeFromMock({ data: [updatedChore], error: null }))
    result.current.refetch()

    await waitFor(() => expect(result.current.chores[0].title).toBe('כיבוי אורות'))
  })
})
```

- [ ] **Step 2: Write failing tests for useFamilyMembers**

Create `src/hooks/__tests__/useFamilyMembers.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import { useFamilyMembers } from '../useFamilyMembers'

const fakeMembers = [
  {
    id: 'u1', family_id: 'f1', name: 'דנה', avatar_url: null,
    role: 'player' as const, trust_level: 1, coin_balance: 50,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'u2', family_id: 'f1', name: 'יוסי', avatar_url: null,
    role: 'admin' as const, trust_level: 5, coin_balance: 100,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  },
]

describe('useFamilyMembers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useFamilyMembers())
    expect(result.current.loading).toBe(true)
    expect(result.current.members).toEqual([])
  })

  it('returns family members after fetch', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: fakeMembers, error: null }),
    })
    const { result } = renderHook(() => useFamilyMembers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.members).toEqual(fakeMembers)
  })

  it('returns empty array on error', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS error' } }),
    })
    const { result } = renderHook(() => useFamilyMembers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.members).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm run test:run -- src/hooks/__tests__/useChores.test.ts src/hooks/__tests__/useFamilyMembers.test.ts
```

Expected: FAIL — hook files do not exist yet.

- [ ] **Step 4: Create `src/hooks/useChores.ts`**

```typescript
import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Chore } from '../types/database'

interface UseChoresResult {
  chores: Chore[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useChores(): UseChoresResult {
  const [chores, setChores] = useState<Chore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchChores = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('chores')
      .select('*')
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
    if (error) {
      setError(error.message)
    } else {
      setChores((data as Chore[]) ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchChores()
  }, [fetchChores])

  return { chores, loading, error, refetch: fetchChores }
}
```

- [ ] **Step 5: Create `src/hooks/useFamilyMembers.ts`**

```typescript
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

interface UseFamilyMembersResult {
  members: Profile[]
  loading: boolean
}

export function useFamilyMembers(): UseFamilyMembersResult {
  const [members, setMembers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .order('name')
      .then(({ data }) => {
        setMembers((data as Profile[]) ?? [])
        setLoading(false)
      })
  }, [])

  return { members, loading }
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm run test:run -- src/hooks/__tests__/useChores.test.ts src/hooks/__tests__/useFamilyMembers.test.ts
```

Expected: 7 tests PASS (4 useChores + 3 useFamilyMembers).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/
git commit -m "feat: add useChores and useFamilyMembers data hooks"
```

---

## Task 3: Admin Chores List page (TDD)

**Files:**
- Create: `src/pages/admin/chores/__tests__/ChoresPage.test.tsx`
- Create: `src/pages/admin/chores/ChoresPage.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/pages/admin/chores/__tests__/ChoresPage.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: mockRefetch })),
}))
vi.mock('../../../../hooks/useFamilyMembers', () => ({
  useFamilyMembers: vi.fn(() => ({ members: [], loading: false })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', family_id: 'f1' } }),
}))

import { useChores } from '../../../../hooks/useChores'
import { useFamilyMembers } from '../../../../hooks/useFamilyMembers'
import ChoresPage from '../ChoresPage'

const mockUseChores = vi.mocked(useChores)
const mockUseFamilyMembers = vi.mocked(useFamilyMembers)

const activeChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', description: null,
  coin_value: 10, difficulty: 'easy' as const, assigned_to: null,
  is_recurring: false, status: 'active' as const,
  proposed_by: null, approved_by: null, due_date: null,
  last_traded_price: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const pendingChore = {
  ...activeChore,
  id: 'c2',
  title: 'ניקוי חדר',
  status: 'pending_approval' as const,
  proposed_by: 'player-1',
}

function renderChoresPage() {
  return render(<MemoryRouter><ChoresPage /></MemoryRouter>)
}

describe('ChoresPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFamilyMembers.mockReturnValue({ members: [], loading: false })
  })

  it('shows loading spinner while loading', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: true, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no active chores', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByText('אין משימות פעילות')).toBeInTheDocument()
  })

  it('shows active chore title and coin value', () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
    expect(screen.getByText(/10 מטבעות/)).toBeInTheDocument()
  })

  it('shows pending proposal section with approve and reject buttons', () => {
    mockUseChores.mockReturnValue({ chores: [pendingChore], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByText('ניקוי חדר')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'אשר' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'דחה' })).toBeInTheDocument()
  })

  it('archive button calls supabase update with status archived and refetches', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'ארכיון' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'archived' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('approve button sets status to active and refetches', async () => {
    mockUseChores.mockReturnValue({ chores: [pendingChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('reject button sets status to archived and refetches', async () => {
    mockUseChores.mockReturnValue({ chores: [pendingChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'archived' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows link to create new chore', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByRole('link', { name: 'משימה חדשה' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/pages/admin/chores/__tests__/ChoresPage.test.tsx
```

Expected: FAIL — `ChoresPage.tsx` does not exist yet.

- [ ] **Step 3: Create `src/pages/admin/chores/ChoresPage.tsx`**

```typescript
import { Link } from 'react-router-dom'
import { useChores } from '../../../hooks/useChores'
import { useFamilyMembers } from '../../../hooks/useFamilyMembers'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Separator } from '../../../components/ui/separator'
import type { Chore, ChoreDifficulty } from '../../../types/database'

const difficultyLabel: Record<ChoreDifficulty, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
}

const difficultyVariant: Record<ChoreDifficulty, 'secondary' | 'default' | 'destructive'> = {
  easy: 'secondary',
  medium: 'default',
  hard: 'destructive',
}

export default function ChoresPage() {
  const { chores, loading, error, refetch } = useChores()
  const { members } = useFamilyMembers()
  const { profile } = useAuth()

  const activeChores = chores.filter(c => c.status === 'active')
  const pendingChores = chores.filter(c => c.status === 'pending_approval')

  function memberName(id: string | null): string {
    if (!id) return 'בריכה פתוחה'
    return members.find(m => m.id === id)?.name ?? id.slice(0, 8)
  }

  async function archiveChore(chore: Chore) {
    await supabase.from('chores').update({ status: 'archived' }).eq('id', chore.id)
    refetch()
  }

  async function approveChore(chore: Chore) {
    await supabase
      .from('chores')
      .update({ status: 'active', approved_by: profile?.id })
      .eq('id', chore.id)
    refetch()
  }

  async function rejectChore(chore: Chore) {
    await supabase.from('chores').update({ status: 'archived' }).eq('id', chore.id)
    refetch()
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
        <h1 className="text-2xl font-bold">ניהול משימות</h1>
        <Button asChild>
          <Link to="/admin/chores/new">משימה חדשה</Link>
        </Button>
      </div>

      {pendingChores.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">הצעות ממתינות לאישור</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingChores.map(chore => (
              <div key={chore.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{chore.title}</p>
                  <p className="text-sm text-muted-foreground">
                    הוצע ע״י {memberName(chore.proposed_by)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => approveChore(chore)}>אשר</Button>
                  <Button size="sm" variant="outline" onClick={() => rejectChore(chore)}>דחה</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">משימות פעילות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {activeChores.length === 0 ? (
            <p className="text-muted-foreground text-sm">אין משימות פעילות</p>
          ) : (
            activeChores.map((chore, i) => (
              <div key={chore.id}>
                {i > 0 && <Separator className="my-2" />}
                <div className="flex items-center justify-between py-1">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{chore.title}</span>
                      <Badge variant={difficultyVariant[chore.difficulty]}>
                        {difficultyLabel[chore.difficulty]}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {chore.coin_value} מטבעות · {memberName(chore.assigned_to)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/admin/chores/${chore.id}/edit`}>עריכה</Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => archiveChore(chore)}>
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/pages/admin/chores/__tests__/ChoresPage.test.tsx
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/chores/
git commit -m "feat: add admin chores list page with archive and proposal approval"
```

---

## Task 4: Chore Form page (TDD)

**Files:**
- Create: `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx`
- Create: `src/pages/admin/chores/ChoreFormPage.tsx`

The form is used for both create (`/admin/chores/new`, no `:id` param) and edit (`/admin/chores/:id/edit`, has `:id` param). Mode is determined by `useParams().id`.

- [ ] **Step 1: Write the failing tests**

Create `src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

vi.mock('../../../../hooks/useFamilyMembers', () => ({
  useFamilyMembers: vi.fn(() => ({
    members: [{ id: 'p1', name: 'דנה', role: 'player' }],
    loading: false,
  })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', family_id: 'f1' } }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import ChoreFormPage from '../ChoreFormPage'

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/admin/chores/new']}>
      <Routes>
        <Route path="/admin/chores/new" element={<ChoreFormPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function renderEdit(id = 'c1') {
  return render(
    <MemoryRouter initialEntries={[`/admin/chores/${id}/edit`]}>
      <Routes>
        <Route path="/admin/chores/:id/edit" element={<ChoreFormPage />} />
      </Routes>
    </MemoryRouter>
  )
}

const existingChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', description: 'לשטוף כלים',
  coin_value: 10, difficulty: 'easy', assigned_to: null,
  is_recurring: false, status: 'active',
  proposed_by: null, approved_by: null, due_date: null,
  last_traded_price: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

describe('ChoreFormPage — create mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders all required form fields with Hebrew labels', () => {
    renderCreate()
    expect(screen.getByLabelText('שם המשימה')).toBeInTheDocument()
    expect(screen.getByLabelText('תיאור')).toBeInTheDocument()
    expect(screen.getByLabelText('ערך במטבעות')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שמור' })).toBeInTheDocument()
  })

  it('creates a chore on submit and navigates to /admin/chores', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם המשימה'), 'כלי מטבח')
    await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
    await userEvent.type(screen.getByLabelText('ערך במטבעות'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin/chores'))
  })

  it('shows Hebrew error message when insert fails', async () => {
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { message: 'DB error' } }),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם המשימה'), 'כלי מטבח')
    await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
    await userEvent.type(screen.getByLabelText('ערך במטבעות'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשמירת המשימה')
    )
  })

  it('disables submit button while saving', async () => {
    let resolve: (v: unknown) => void
    mockFrom.mockReturnValue({
      insert: vi.fn().mockReturnValue(new Promise(r => { resolve = r })),
    })
    renderCreate()

    await userEvent.type(screen.getByLabelText('שם המשימה'), 'כלי מטבח')
    await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
    await userEvent.type(screen.getByLabelText('ערך במטבעות'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    expect(screen.getByRole('button', { name: /שומר/ })).toBeDisabled()
    resolve!({ error: null })
  })
})

describe('ChoreFormPage — edit mode', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pre-fills form with existing chore data', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: existingChore, error: null }),
    })
    renderEdit('c1')

    await waitFor(() =>
      expect((screen.getByLabelText('שם המשימה') as HTMLInputElement).value).toBe('כלי מטבח')
    )
    expect((screen.getByLabelText('תיאור') as HTMLTextAreaElement).value).toBe('לשטוף כלים')
  })

  it('updates chore on submit and navigates to /admin/chores', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: existingChore, error: null }),
      })
      .mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      })
    renderEdit('c1')

    await waitFor(() =>
      expect((screen.getByLabelText('שם המשימה') as HTMLInputElement).value).toBe('כלי מטבח')
    )

    await userEvent.clear(screen.getByLabelText('שם המשימה'))
    await userEvent.type(screen.getByLabelText('שם המשימה'), 'כיבוי אורות')
    await userEvent.click(screen.getByRole('button', { name: 'שמור' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin/chores'))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx
```

Expected: FAIL — `ChoreFormPage.tsx` does not exist yet.

- [ ] **Step 3: Create `src/pages/admin/chores/ChoreFormPage.tsx`**

```typescript
import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useFamilyMembers } from '../../../hooks/useFamilyMembers'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { Textarea } from '../../../components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import type { ChoreDifficulty, ChoreStatus } from '../../../types/database'

export default function ChoreFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = id !== undefined
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { members } = useFamilyMembers()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coinValue, setCoinValue] = useState('1')
  const [difficulty, setDifficulty] = useState<ChoreDifficulty>('easy')
  const [assignedTo, setAssignedTo] = useState('none')
  const [dueDate, setDueDate] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isEditMode) return
    supabase
      .from('chores')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        if (!data) return
        setTitle(data.title)
        setDescription(data.description ?? '')
        setCoinValue(String(data.coin_value))
        setDifficulty(data.difficulty as ChoreDifficulty)
        setAssignedTo(data.assigned_to ?? 'none')
        setDueDate(data.due_date ?? '')
        setIsRecurring(data.is_recurring)
      })
  }, [id, isEditMode])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const payload = {
        title,
        description: description || null,
        coin_value: Number(coinValue),
        difficulty,
        assigned_to: assignedTo === 'none' ? null : assignedTo,
        due_date: dueDate || null,
        is_recurring: isRecurring,
      }

      let err: { message: string } | null = null

      if (isEditMode) {
        const result = await supabase.from('chores').update(payload).eq('id', id!)
        err = result.error
      } else {
        const result = await supabase.from('chores').insert({
          ...payload,
          family_id: profile!.family_id!,
          status: 'active' as ChoreStatus,
        })
        err = result.error
      }

      if (err) {
        setError('שגיאה בשמירת המשימה')
      } else {
        navigate('/admin/chores')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg" dir="rtl">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/chores">← חזרה</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isEditMode ? 'עריכת משימה' : 'משימה חדשה'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="title">שם המשימה</Label>
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
              <Label htmlFor="coinValue">ערך במטבעות</Label>
              <Input
                id="coinValue"
                type="number"
                min={1}
                value={coinValue}
                onChange={e => setCoinValue(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label>רמת קושי</Label>
              <Select value={difficulty} onValueChange={v => setDifficulty(v as ChoreDifficulty)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">קל</SelectItem>
                  <SelectItem value="medium">בינוני</SelectItem>
                  <SelectItem value="hard">קשה</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>שייך ל</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">בריכה פתוחה (כולם)</SelectItem>
                  {members.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="dueDate">תאריך יעד (אופציונלי)</Label>
              <Input
                id="dueDate"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="isRecurring"
                type="checkbox"
                checked={isRecurring}
                onChange={e => setIsRecurring(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="isRecurring">משימה שבועית חוזרת</Label>
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/chores/ChoreFormPage.tsx src/pages/admin/chores/__tests__/ChoreFormPage.test.tsx
git commit -m "feat: add chore create/edit form with Hebrew labels and validation"
```

---

## Task 5: Wire routes, AdminLayout nav link, and AdminDashboard summary

**Files:**
- Modify: `src/router.tsx`
- Modify: `src/components/layout/AdminLayout.tsx`
- Modify: `src/pages/admin/AdminDashboard.tsx`

- [ ] **Step 1: Add chore routes to `src/router.tsx`**

Open `src/router.tsx`. The `/admin` route already has `children: [{ index: true, element: <AdminDashboard /> }]`. Extend it to:

```typescript
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import AdminDashboard from './pages/admin/AdminDashboard'
import ChoresPage from './pages/admin/chores/ChoresPage'
import ChoreFormPage from './pages/admin/chores/ChoreFormPage'
import PlayerDashboard from './pages/player/PlayerDashboard'
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

- [ ] **Step 2: Add "משימות" nav link to `src/components/layout/AdminLayout.tsx`**

Open `src/components/layout/AdminLayout.tsx`. In the `<nav>` section, add a NavLink for chores alongside the existing dashboard link:

```typescript
<nav className="hidden md:flex items-center gap-2">
  <NavLink
    to="/admin"
    end
    className={({ isActive }) =>
      `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
    }
  >
    דשבורד
  </NavLink>
  <NavLink
    to="/admin/chores"
    className={({ isActive }) =>
      `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
    }
  >
    משימות
  </NavLink>
</nav>
```

- [ ] **Step 3: Update `src/pages/admin/AdminDashboard.tsx` with pending count**

Replace the entire file:

```typescript
import { Link } from 'react-router-dom'
import { useChores } from '../../hooks/useChores'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'

export default function AdminDashboard() {
  const { chores } = useChores()
  const pendingCount = chores.filter(c => c.status === 'pending_approval').length

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
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run all tests**

```bash
npm run test:run
```

Expected: all tests PASS (previous tests unaffected).

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/router.tsx src/components/layout/AdminLayout.tsx src/pages/admin/AdminDashboard.tsx
git commit -m "feat: wire chore management routes, nav link, and dashboard summary"
```

---

## Self-Review Checklist

**Spec section 4.1 coverage:**
- [x] Admin creates chores with title, description, coin value, difficulty, optional assignee, optional due date, recurring flag → `ChoreFormPage`
- [x] Open-pool chores (assigned_to = null) created via form → `ChoreFormPage`
- [x] Kid-proposed chores (status `pending_approval`) appear in admin queue → `ChoresPage` pending section
- [x] Admin approves/rejects proposals → `ChoresPage` approve/reject buttons
- [x] Admin archives active chores → `ChoresPage` archive button
- [x] Admin edits existing chores → `ChoreFormPage` edit mode

**Out of scope for this plan (covered in later plans):**
- Recurring chore auto-population each week → Plan 3 or cron Edge Function
- Players picking up open-pool chores → Plan 3 (Player Chore Flow)
- Chore completion photo submission and admin review → Plan 3
