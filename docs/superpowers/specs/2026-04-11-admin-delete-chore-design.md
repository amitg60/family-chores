# Admin Delete Chore — Design Spec
**Date:** 2026-04-11
**Status:** Approved for implementation planning

---

## Overview

Add a **Delete** action for admins on active chores in `ChoresPage`. Delete is a soft delete — it sets `status = 'deleted'` on the chore row. Deleted chores are permanently hidden from all views and are **not recoverable** (unlike Archive, which is reversible). The chore row is kept in the database to preserve referential integrity with assignments, completions, and coin transactions.

---

## 1. Decision: Archive vs Delete

| | Archive | Delete |
|---|---|---|
| DB row kept | Yes | Yes |
| Visible in app | No | No |
| Recoverable | Yes (future) | No |
| Use case | Temporarily retire a chore | Permanently remove from view |

Delete appears **alongside Archive** on active chores only. Pending chores (approval queue) are not affected.

---

## 2. Database

**New migration:** `supabase/migrations/003_add_deleted_chore_status.sql`

```sql
ALTER TYPE chore_status ADD VALUE IF NOT EXISTS 'deleted';
```

No RLS changes required — the existing `chores: admins can update` policy already permits admins to update any chore field within their family.

---

## 3. TypeScript Types

**File:** `src/types/database.ts`

Add `'deleted'` to the `ChoreStatus` union:

```ts
export type ChoreStatus = 'active' | 'pending_approval' | 'archived' | 'deleted'
```

---

## 4. Data Layer

**File:** `src/hooks/useChores.ts`

Change the query filter from one `.neq()` to two chained `.neq()` calls:

```ts
// before
.neq('status', 'archived')

// after
.neq('status', 'archived')
.neq('status', 'deleted')
```

This keeps the chain shape consistent with the existing mock pattern in tests.

---

## 5. UI

**File:** `src/pages/admin/chores/ChoresPage.tsx`

### Delete function

```ts
async function deleteChore(chore: Chore) {
  setMutationError(null)
  const { error } = await supabase.from('chores').update({ status: 'deleted' }).eq('id', chore.id)
  if (error) { setMutationError('שגיאה במחיקת המשימה') } else { refetch() }
}
```

### Confirmation dialog state

```ts
const [choreToDelete, setChoreToDelete] = useState<Chore | null>(null)
```

### Delete button (added next to Archive in active chores list)

```tsx
<Button size="sm" variant="destructive" onClick={() => setChoreToDelete(chore)}>
  מחק
</Button>
```

### Confirmation dialog (Hebrew, using shadcn Dialog — already in project)

```
מחיקת משימה
האם למחוק את המשימה "[chore title]"? לא ניתן לשחזר.
[ביטול]  [מחק]  ← destructive variant
```

On confirm: calls `deleteChore(choreToDelete)`, clears `choreToDelete`.
On cancel / close: clears `choreToDelete`.

---

## 6. Tests

### `src/hooks/__tests__/useChores.test.ts`

- Update the `makeFromMock` helper to chain two `neq` calls instead of one (mock returns `this`, so chaining works already — just verify no test assertions break).

### `src/pages/admin/chores/__tests__/ChoresPage.test.tsx`

Add three new test cases:

1. **Delete button renders** — active chore row shows a "מחק" button.
2. **Delete button opens confirmation dialog** — clicking "מחק" renders the dialog with the chore title.
3. **Confirming delete calls supabase update with `status: 'deleted'` and refetches.**
4. **Cancelling dialog does not call supabase update.**
5. **Supabase error on delete shows Hebrew error alert.**

---

## 7. Files Changed

| File | Change |
|---|---|
| `supabase/migrations/003_add_deleted_chore_status.sql` | New — adds `deleted` enum value |
| `src/types/database.ts` | Add `'deleted'` to `ChoreStatus` |
| `src/hooks/useChores.ts` | Add second `.neq('status', 'deleted')` |
| `src/pages/admin/chores/ChoresPage.tsx` | Add `deleteChore`, `choreToDelete` state, Delete button, confirmation Dialog |
| `src/hooks/__tests__/useChores.test.ts` | Update mock chain; verify no regressions |
| `src/pages/admin/chores/__tests__/ChoresPage.test.tsx` | Add 5 delete-related test cases |

---

## 8. Out of Scope

- Showing deleted chores anywhere (no "trash" view)
- Bulk delete
- Delete on pending/archived chores
- Delete on rewards (separate feature if needed)
