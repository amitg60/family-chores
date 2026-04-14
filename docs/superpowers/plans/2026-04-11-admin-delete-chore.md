# Admin Delete Chore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a soft-delete action for admins on active chores — sets `status = 'deleted'`, permanently hides the chore from all views, with a Hebrew confirmation dialog before committing.

**Architecture:** Extend the existing `chore_status` PostgreSQL enum with a `deleted` value. The `useChores` hook already filters by status — add a second `.neq()` call. `ChoresPage` gets a Delete button per active chore that opens a controlled `Dialog` (shadcn/ui, already installed) for confirmation before calling Supabase.

**Tech Stack:** React 18 + TypeScript, Supabase JS v2, shadcn/ui Dialog, Vitest + React Testing Library

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/015_deleted_chore_status.sql` | New — adds `deleted` to `chore_status` enum |
| `src/types/database.ts` | Add `'deleted'` to `ChoreStatus` union type |
| `src/hooks/useChores.ts` | Add second `.neq('status', 'deleted')` filter |
| `src/hooks/__tests__/useChores.test.ts` | Add test verifying both statuses are excluded |
| `src/pages/admin/chores/ChoresPage.tsx` | Add `deleteChore`, `choreToDelete` state, Delete button, confirmation Dialog |
| `src/pages/admin/chores/__tests__/ChoresPage.test.tsx` | Add 5 delete-related test cases |

---

## Task 1: DB migration and TypeScript type

**Files:**
- Create: `supabase/migrations/015_deleted_chore_status.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/015_deleted_chore_status.sql`:

```sql
ALTER TYPE chore_status ADD VALUE IF NOT EXISTS 'deleted';
```

- [ ] **Step 2: Apply the migration**

```bash
cd /d/Claude_Projects/family-chores
npx supabase db push
```

Expected: `Applying migration 015_deleted_chore_status.sql...` with no errors.

- [ ] **Step 3: Add `'deleted'` to `ChoreStatus` in `src/types/database.ts`**

Find this line (around line 3):

```ts
export type ChoreStatus = 'active' | 'pending_approval' | 'archived'
```

Replace with:

```ts
export type ChoreStatus = 'active' | 'pending_approval' | 'archived' | 'deleted'
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /d/Claude_Projects/family-chores
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/015_deleted_chore_status.sql src/types/database.ts
git commit -m "feat: add deleted value to chore_status enum and TypeScript type"
```

---

## Task 2: Update useChores hook to exclude deleted chores

**Files:**
- Modify: `src/hooks/useChores.ts`
- Modify: `src/hooks/__tests__/useChores.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/hooks/__tests__/useChores.test.ts`. Add this test inside the `describe('useChores')` block, after the existing tests:

```ts
it('excludes both archived and deleted chores from query', async () => {
  const mock = makeFromMock({ data: [], error: null })
  mockFrom.mockReturnValue(mock)
  renderHook(() => useChores())
  await waitFor(() => expect(mock.order).toHaveBeenCalled())
  expect(mock.neq).toHaveBeenCalledWith('status', 'archived')
  expect(mock.neq).toHaveBeenCalledWith('status', 'deleted')
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /d/Claude_Projects/family-chores
npx vitest run src/hooks/__tests__/useChores.test.ts
```

Expected: FAIL — `expect(mock.neq).toHaveBeenCalledWith('status', 'deleted')` — the second call doesn't happen yet.

- [ ] **Step 3: Update `src/hooks/useChores.ts`**

Find the query chain (around line 27):

```ts
    const { data, error } = await supabase
      .from('chores')
      .select('*')
      .neq('status', 'archived')
      .order('created_at', { ascending: false })
```

Replace with:

```ts
    const { data, error } = await supabase
      .from('chores')
      .select('*')
      .neq('status', 'archived')
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
```

- [ ] **Step 4: Run all useChores tests to verify they pass**

```bash
npx vitest run src/hooks/__tests__/useChores.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useChores.ts src/hooks/__tests__/useChores.test.ts
git commit -m "feat: exclude deleted chores from useChores query"
```

---

## Task 3: Add Delete button and confirmation dialog to ChoresPage

**Files:**
- Modify: `src/pages/admin/chores/ChoresPage.tsx`
- Modify: `src/pages/admin/chores/__tests__/ChoresPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Open `src/pages/admin/chores/__tests__/ChoresPage.test.tsx`.

Add `within` to the import at the top:

```ts
import { render, screen, waitFor, within } from '@testing-library/react'
```

Add these five tests inside the `describe('ChoresPage')` block, after the existing tests:

```ts
  it('shows delete button for each active chore', () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByRole('button', { name: 'מחק' })).toBeInTheDocument()
  })

  it('clicking delete button opens confirmation dialog with chore title', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'מחק' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText(/כלי מטבח/)).toBeInTheDocument()
  })

  it('confirming delete calls supabase update with status deleted and refetches', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'מחק' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'מחק' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'deleted' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('cancelling dialog does not call supabase update', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'מחק' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ביטול' }))
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('shows error alert when delete mutation fails', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'מחק' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'מחק' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה במחיקת המשימה')
      expect(mockRefetch).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/pages/admin/chores/__tests__/ChoresPage.test.tsx
```

Expected: the 5 new tests FAIL (no delete button or dialog yet). Existing tests should still PASS.

- [ ] **Step 3: Replace `src/pages/admin/chores/ChoresPage.tsx` with the updated version**

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useChores } from '../../../hooks/useChores'
import { useFamilyMembers } from '../../../hooks/useFamilyMembers'
import { useAuth } from '../../../contexts/AuthContext'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Separator } from '../../../components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
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
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [choreToDelete, setChoreToDelete] = useState<Chore | null>(null)

  const activeChores = chores.filter(c => c.status === 'active')
  const pendingChores = chores.filter(c => c.status === 'pending_approval')

  function memberName(id: string | null): string {
    if (!id) return 'בריכה פתוחה'
    return members.find(m => m.id === id)?.name ?? id.slice(0, 8)
  }

  async function archiveChore(chore: Chore) {
    setMutationError(null)
    const { error } = await supabase.from('chores').update({ status: 'archived' }).eq('id', chore.id)
    if (error) { setMutationError('שגיאה בארכוב המשימה') } else { refetch() }
  }

  async function approveChore(chore: Chore) {
    setMutationError(null)
    const { error } = await supabase
      .from('chores')
      .update({ status: 'active', approved_by: profile?.id })
      .eq('id', chore.id)
    if (error) { setMutationError('שגיאה באישור ההצעה') } else { refetch() }
  }

  async function rejectChore(chore: Chore) {
    setMutationError(null)
    const { error } = await supabase.from('chores').update({ status: 'archived' }).eq('id', chore.id)
    if (error) { setMutationError('שגיאה בדחיית ההצעה') } else { refetch() }
  }

  async function deleteChore(chore: Chore) {
    setMutationError(null)
    const { error } = await supabase.from('chores').update({ status: 'deleted' }).eq('id', chore.id)
    if (error) {
      setMutationError('שגיאה במחיקת המשימה')
    } else {
      setChoreToDelete(null)
      refetch()
    }
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

      {mutationError && (
        <p role="alert" className="text-sm text-destructive">{mutationError}</p>
      )}

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
                    <Button size="sm" variant="destructive" onClick={() => setChoreToDelete(chore)}>
                      מחק
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={choreToDelete !== null} onOpenChange={(open) => { if (!open) setChoreToDelete(null) }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>מחיקת משימה</DialogTitle>
            <DialogDescription>
              האם למחוק את המשימה &quot;{choreToDelete?.title}&quot;? לא ניתן לשחזר.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChoreToDelete(null)}>ביטול</Button>
            <Button
              variant="destructive"
              onClick={() => { if (choreToDelete) deleteChore(choreToDelete) }}
            >
              מחק
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 4: Run all ChoresPage tests to verify they pass**

```bash
npx vitest run src/pages/admin/chores/__tests__/ChoresPage.test.tsx
```

Expected: all tests PASS (existing + 5 new).

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/chores/ChoresPage.tsx src/pages/admin/chores/__tests__/ChoresPage.test.tsx
git commit -m "feat: add admin delete chore with confirmation dialog"
```
