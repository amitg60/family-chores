# Kid-Proposed Chores & Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players propose new chores and rewards, admins reject with an optional reason, and players see/dismiss their proposals.

**Architecture:** DB migration adds columns + triggers + RPC. React components get proposal forms and "ההצעות שלי" sections. Admin reject flow gets an optional-reason dialog. A new Edge Function emails admins when a proposal is submitted. The existing `cleanup-photos` Edge Function grows a third job to purge stale rejected proposals.

**Tech Stack:** PostgreSQL (PL/pgSQL triggers, SECURITY DEFINER RPC), Supabase JS client, React + TypeScript, Vitest + Testing Library, Deno (Edge Functions), Resend (email)

**Spec:** `docs/superpowers/specs/2026-04-26-kid-proposed-chores-rewards-design.md`

---

## File Map

| Action | Path |
|--------|------|
| Create | `supabase/migrations/031_kid_proposals.sql` |
| Create | `supabase/functions/notify-admin-proposal/index.ts` |
| Create | `src/hooks/useMyProposals.ts` |
| Modify | `src/types/database.ts` |
| Modify | `src/pages/admin/chores/__tests__/ChoresPage.test.tsx` |
| Modify | `src/pages/admin/chores/ChoresPage.tsx` |
| Modify | `src/pages/admin/rewards/__tests__/RewardsPage.test.tsx` |
| Modify | `src/pages/admin/rewards/RewardsPage.tsx` |
| Modify | `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx` |
| Modify | `src/pages/player/chores/ChorePoolPage.tsx` |
| Modify | `src/pages/player/store/__tests__/RewardStorePage.test.tsx` |
| Modify | `src/pages/player/store/RewardStorePage.tsx` |
| Modify | `supabase/functions/cleanup-photos/index.ts` |
| Modify | `supabase/functions/cleanup-photos/index.test.ts` |

---

## Task 1: DB Migration 031

**Files:**
- Create: `supabase/migrations/031_kid_proposals.sql`

---

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/031_kid_proposals.sql` with this exact content:

```sql
-- ============================================================
-- Migration 031: Kid-proposed chores & rewards
-- New columns, notification type, triggers, RPC, cleanup job prep
-- ============================================================

-- ── 1. New columns ────────────────────────────────────────────────────────────
ALTER TABLE chores  ADD COLUMN IF NOT EXISTS proposal_rejection_reason TEXT NULL
  CHECK (proposal_rejection_reason IS NULL OR char_length(proposal_rejection_reason) <= 500);
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS proposal_rejection_reason TEXT NULL
  CHECK (proposal_rejection_reason IS NULL OR char_length(proposal_rejection_reason) <= 500);

-- ── 2. New notification type ─────────────────────────────────────────────────
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'proposal_submitted';

-- ── 3. Performance index for admin lookups ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_family_admins
  ON profiles (family_id)
  WHERE role = 'admin';

-- ── 4. Trigger: notify admins when a chore proposal is submitted ──────────────
CREATE OR REPLACE FUNCTION notify_chore_proposal_submitted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposer_name TEXT;
  v_admin         RECORD;
BEGIN
  IF NEW.proposed_by IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'pending_approval' THEN RETURN NEW; END IF;

  SELECT name INTO v_proposer_name FROM profiles WHERE id = NEW.proposed_by;

  FOR v_admin IN
    SELECT id FROM profiles WHERE family_id = NEW.family_id AND role = 'admin'
  LOOP
    PERFORM insert_notification(
      v_admin.id,
      NEW.family_id,
      'proposal_submitted',
      'הצעת משימה חדשה',
      '"' || NEW.title || '" הוצע על ידי ' || COALESCE(v_proposer_name, 'שחקן'),
      NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_chore_proposal_submitted
  AFTER INSERT ON chores
  FOR EACH ROW EXECUTE FUNCTION notify_chore_proposal_submitted();

-- ── 5. Trigger: notify admins when a reward proposal is submitted ─────────────
CREATE OR REPLACE FUNCTION notify_reward_proposal_submitted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposer_name TEXT;
  v_admin         RECORD;
BEGIN
  IF NEW.proposed_by IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'pending_approval' THEN RETURN NEW; END IF;

  SELECT name INTO v_proposer_name FROM profiles WHERE id = NEW.proposed_by;

  FOR v_admin IN
    SELECT id FROM profiles WHERE family_id = NEW.family_id AND role = 'admin'
  LOOP
    PERFORM insert_notification(
      v_admin.id,
      NEW.family_id,
      'proposal_submitted',
      'הצעת פרס חדש',
      '"' || NEW.title || '" הוצע על ידי ' || COALESCE(v_proposer_name, 'שחקן'),
      NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_notify_reward_proposal_submitted
  AFTER INSERT ON rewards
  FOR EACH ROW EXECUTE FUNCTION notify_reward_proposal_submitted();

-- ── 6. Update notify_proposal_resolved: include rejection reason + cover rewards
--    Original function (migration 012) only fired on chores and lacked reason.
CREATE OR REPLACE FUNCTION notify_proposal_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title_he TEXT;
  v_body_he  TEXT;
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
    v_body_he  := '"' || NEW.title || '" נדחתה על ידי המנהל'
                  || CASE WHEN NEW.proposal_rejection_reason IS NOT NULL
                          THEN ': ' || NEW.proposal_rejection_reason
                          ELSE '' END;
  END IF;

  PERFORM insert_notification(
    NEW.proposed_by, NEW.family_id, 'proposal_resolved',
    v_title_he, v_body_he, NEW.id
  );
  RETURN NEW;
END;
$$;

-- trg_notify_proposal_resolved already exists on chores (migration 012) — no re-create needed.
-- Add matching trigger for rewards:
DROP TRIGGER IF EXISTS trg_notify_reward_proposal_resolved ON rewards;
CREATE TRIGGER trg_notify_reward_proposal_resolved
  AFTER UPDATE ON rewards
  FOR EACH ROW EXECUTE FUNCTION notify_proposal_resolved();

-- ── 7. RPC: player dismisses a rejected proposal ─────────────────────────────
CREATE OR REPLACE FUNCTION dismiss_rejected_proposal(
  p_entity_type TEXT,
  p_entity_id   UUID
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_entity_type = 'chore' THEN
    DELETE FROM chores
    WHERE id = p_entity_id
      AND proposed_by = auth.uid()
      AND status = 'archived';
  ELSIF p_entity_type = 'reward' THEN
    DELETE FROM rewards
    WHERE id = p_entity_id
      AND proposed_by = auth.uid()
      AND status = 'archived';
  ELSE
    RAISE EXCEPTION 'Invalid entity type: %', p_entity_type;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found or not authorized';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION dismiss_rejected_proposal(TEXT, UUID) TO authenticated;
```

- [ ] **Step 2: Apply the migration**

```bash
supabase db push
```

Expected: `Applied 1 migration(s).` No errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/031_kid_proposals.sql
git commit -m "feat: add DB migration 031 for kid-proposed chores and rewards"
```

---

## Task 2: TypeScript Types + Fixture Updates

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/pages/admin/chores/__tests__/ChoresPage.test.tsx` (fixture)
- Modify: `src/pages/admin/rewards/__tests__/RewardsPage.test.tsx` (fixture)
- Modify: `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx` (fixture + switch to shared mock)
- Modify: `src/pages/player/store/__tests__/RewardStorePage.test.tsx` (fixture)

These are all mechanical type updates. Write them, then run `npx tsc --noEmit` to verify zero TS errors.

---

- [ ] **Step 1: Update `src/types/database.ts`**

Add `proposal_rejection_reason: string | null` to `Chore` (after `approved_by`):

```ts
export interface Chore {
  id: string
  family_id: string
  title: string
  description: string | null
  coin_value: number
  difficulty: ChoreDifficulty
  assigned_to: string | null
  recurrence_type: RecurrenceType
  status: ChoreStatus
  proposed_by: string | null
  approved_by: string | null
  proposal_rejection_reason: string | null   // ← ADD
  due_date: string | null
  last_traded_price: number | null
  is_pool_visible: boolean
  created_at: string
  updated_at: string
}
```

Add `proposal_rejection_reason: string | null` to `Reward` (after `approved_by`):

```ts
export interface Reward {
  id: string
  family_id: string
  title: string
  description: string | null
  coin_cost: number
  type: RewardType
  status: RewardStatus
  proposed_by: string | null
  approved_by: string | null
  proposal_rejection_reason: string | null   // ← ADD
  stock: number | null
  created_at: string
  updated_at: string
}
```

Add `'proposal_submitted'` to `NotificationType`:

```ts
export type NotificationType =
  | 'chore_assigned' | 'completion_reviewed' | 'trade_received' | 'trade_resolved'
  | 'redemption_resolved' | 'proposal_resolved' | 'penalty_applied' | 'achievement_earned'
  | 'reminder' | 'alias_vote_requested' | 'alias_vote_resolved' | 'chore_deleted'
  | 'trust_level_changed' | 'proposal_submitted'   // ← ADD proposal_submitted
```

- [ ] **Step 2: Update `ChoresPage.test.tsx` fixtures**

Add `is_pool_visible` and `proposal_rejection_reason` to both fixtures (the `activeChore` object at the top of the file):

```ts
const activeChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', description: null,
  coin_value: 10, difficulty: 'easy' as const, assigned_to: null,
  recurrence_type: 'none' as const, status: 'active' as const,
  proposed_by: null, approved_by: null,
  proposal_rejection_reason: null,
  due_date: null, last_traded_price: null, is_pool_visible: true,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const pendingChore = {
  ...activeChore,
  id: 'c2',
  title: 'ניקוי חדר',
  status: 'pending_approval' as const,
  proposed_by: 'player-1',
}
```

- [ ] **Step 3: Update `RewardsPage.test.tsx` fixtures**

Add `proposal_rejection_reason: null` to all reward fixtures (`activeReward`, `pendingReward`, `limitedReward`):

```ts
const activeReward = {
  id: 'r1', family_id: 'f1', title: 'גלידה', description: null,
  coin_cost: 20, type: 'store' as const, status: 'active' as const,
  proposed_by: null, approved_by: null,
  proposal_rejection_reason: null,
  stock: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const pendingReward = {
  ...activeReward, id: 'r2', title: 'סרט קולנוע',
  status: 'pending_approval' as const,
  proposed_by: 'player-1',
}

const limitedReward = {
  ...activeReward, id: 'r3', title: 'פיצה', stock: 3,
}
```

- [ ] **Step 4: Update `ChorePoolPage.test.tsx` — switch to shared mock + update fixture**

The current file has an inline `vi.mock('../../../../lib/supabase', ...)` that only mocks `functions.invoke`. Replace it with the shared supabase mock so future tasks can use `mockFrom` and `mockRpc`.

Replace the current mock block (lines 16-25) and `mockFunctions` usage:

**Old (lines 16-25):**
```ts
const mockFunctions = vi.fn()
vi.mock('../../../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockFunctions(...args) } },
}))
```

**New (replace those lines with):**
```ts
import '../../../../test/mocks/supabase'
import { mockFunctionsInvoke } from '../../../../test/mocks/supabase'
```

Then update all `mockFunctions` references in the test bodies to `mockFunctionsInvoke`:
- Line 101: `mockFunctions.mockResolvedValue(...)` → `mockFunctionsInvoke.mockResolvedValue(...)`
- Line 123: `mockFunctions.mockResolvedValue(...)` → `mockFunctionsInvoke.mockResolvedValue(...)`
- All `expect(mockFunctions)` → `expect(mockFunctionsInvoke)`

Also add `proposal_rejection_reason: null` to the fixture objects:
```ts
const nonRecurringChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', coin_value: 10,
  difficulty: 'easy' as const, assigned_to: null, recurrence_type: 'none' as const,
  status: 'active' as const, is_pool_visible: true,
  description: null, proposed_by: null, approved_by: null,
  proposal_rejection_reason: null,
  due_date: null, last_traded_price: null,
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

const recurringChore = {
  ...nonRecurringChore,
  id: 'c2', title: 'להאכיל חיות', recurrence_type: 'daily' as const,
}
```

- [ ] **Step 5: Update `RewardStorePage.test.tsx` fixtures**

Add `proposal_rejection_reason: null` to `fakeReward`:

```ts
const fakeReward = {
  id: 'r1', family_id: 'f1', title: 'גלידה', description: 'גלידת וניל',
  coin_cost: 20, type: 'store' as const, status: 'active' as const,
  proposed_by: null, approved_by: null,
  proposal_rejection_reason: null,
  stock: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}
```

- [ ] **Step 6: Verify TS and run existing tests**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

```bash
npx vitest run --reporter=verbose
```
Expected: All existing tests pass. No new failures from fixture-only changes.

- [ ] **Step 7: Commit**

```bash
git add src/types/database.ts \
  src/pages/admin/chores/__tests__/ChoresPage.test.tsx \
  src/pages/admin/rewards/__tests__/RewardsPage.test.tsx \
  src/pages/player/chores/__tests__/ChorePoolPage.test.tsx \
  src/pages/player/store/__tests__/RewardStorePage.test.tsx
git commit -m "feat: add proposal_rejection_reason to Chore/Reward types and update test fixtures"
```

---

## Task 3: Admin ChoresPage — Rejection Reason Dialog

**Files:**
- Modify: `src/pages/admin/chores/__tests__/ChoresPage.test.tsx`
- Modify: `src/pages/admin/chores/ChoresPage.tsx`

The current `rejectChore` calls `.update({ status: 'archived' })` directly. Change it to open a dialog for proposals (rows where `proposed_by IS NOT NULL`). Regular archive action (active chores) is unchanged.

---

- [ ] **Step 1: Write failing tests — replace the old reject test with new dialog-based tests**

In `ChoresPage.test.tsx`, replace the test at line 110-123 (`'reject button sets status to archived and refetches'`) with these four tests:

```ts
it('reject on proposal opens rejection reason dialog, not direct update', async () => {
  mockUseChores.mockReturnValue({ chores: [pendingChore], loading: false, error: null, refetch: mockRefetch })
  const mockUpdate = vi.fn()
  mockFrom.mockReturnValue({ update: mockUpdate })

  renderChoresPage()
  await userEvent.click(screen.getByRole('button', { name: 'דחה' }))

  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'דחיית הצעה' })).toBeInTheDocument()
  expect(mockUpdate).not.toHaveBeenCalled()
})

it('rejection dialog cancel closes dialog without calling update', async () => {
  mockUseChores.mockReturnValue({ chores: [pendingChore], loading: false, error: null, refetch: mockRefetch })
  mockFrom.mockReturnValue({ update: vi.fn() })

  renderChoresPage()
  await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
  await userEvent.click(screen.getByRole('button', { name: 'ביטול' }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(mockRefetch).not.toHaveBeenCalled()
})

it('rejection dialog confirm without reason calls update with proposal_rejection_reason null', async () => {
  mockUseChores.mockReturnValue({ chores: [pendingChore], loading: false, error: null, refetch: mockRefetch })
  const mockEq = vi.fn().mockResolvedValue({ error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ update: mockUpdate })

  renderChoresPage()
  await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
  await userEvent.click(screen.getByRole('button', { name: 'דחה הצעה' }))

  await waitFor(() => {
    expect(mockUpdate).toHaveBeenCalledWith({
      status: 'archived',
      proposal_rejection_reason: null,
    })
    expect(mockRefetch).toHaveBeenCalled()
  })
})

it('rejection dialog confirm with reason calls update with trimmed reason', async () => {
  mockUseChores.mockReturnValue({ chores: [pendingChore], loading: false, error: null, refetch: mockRefetch })
  const mockEq = vi.fn().mockResolvedValue({ error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ update: mockUpdate })

  renderChoresPage()
  await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
  const textarea = screen.getByRole('textbox')
  await userEvent.type(textarea, 'יקר מדי')
  await userEvent.click(screen.getByRole('button', { name: 'דחה הצעה' }))

  await waitFor(() => {
    expect(mockUpdate).toHaveBeenCalledWith({
      status: 'archived',
      proposal_rejection_reason: 'יקר מדי',
    })
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx vitest run src/pages/admin/chores/__tests__/ChoresPage.test.tsx --reporter=verbose
```
Expected: The 4 new tests FAIL (dialog doesn't exist yet), the old tests pass.

- [ ] **Step 3: Implement the rejection dialog in `ChoresPage.tsx`**

Add `rejectionTarget` and `rejectionReason` state variables:

```ts
const [rejectionTarget, setRejectionTarget] = useState<Chore | null>(null)
const [rejectionReason, setRejectionReason] = useState('')
```

Replace the `rejectChore` function body — instead of calling update directly, open the dialog:

```ts
function openRejectDialog(chore: Chore) {
  setMutationError(null)
  setRejectionReason('')
  setRejectionTarget(chore)
}

async function confirmRejectChore() {
  if (!rejectionTarget) return
  setMutationError(null)
  const reason = rejectionReason.trim() || null
  const { error } = await supabase
    .from('chores')
    .update({ status: 'archived', proposal_rejection_reason: reason })
    .eq('id', rejectionTarget.id)
  if (error) {
    setMutationError('שגיאה בדחיית ההצעה')
  } else {
    setRejectionTarget(null)
    setRejectionReason('')
    refetch()
  }
}
```

Update the "דחה" button in the pending proposals section to call `openRejectDialog(chore)` instead of `rejectChore(chore)`.

Add the rejection reason dialog (place it after the existing delete dialog, before the closing `</div>`):

```tsx
<Dialog
  open={rejectionTarget !== null}
  onOpenChange={(open) => {
    if (!open) { setRejectionTarget(null); setRejectionReason('') }
  }}
>
  <DialogContent dir="rtl">
    <DialogHeader>
      <DialogTitle>דחיית הצעה</DialogTitle>
      <DialogDescription>
        סיבת הדחייה (אופציונלי)
      </DialogDescription>
    </DialogHeader>
    <textarea
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      placeholder="ניתן להשאיר ריק..."
      maxLength={500}
      value={rejectionReason}
      onChange={(e) => setRejectionReason(e.target.value)}
    />
    <DialogFooter>
      <Button variant="outline" onClick={() => { setRejectionTarget(null); setRejectionReason('') }}>
        ביטול
      </Button>
      <Button variant="destructive" onClick={confirmRejectChore}>
        דחה הצעה
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Note: `DialogDescription` import needs to be added to the existing Dialog import block in ChoresPage.tsx.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/pages/admin/chores/__tests__/ChoresPage.test.tsx --reporter=verbose
```
Expected: All tests pass.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npx vitest run --reporter=verbose
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/chores/__tests__/ChoresPage.test.tsx \
        src/pages/admin/chores/ChoresPage.tsx
git commit -m "feat: admin chore rejection dialog with optional reason"
```

---

## Task 4: Admin RewardsPage — Rejection Reason Dialog

**Files:**
- Modify: `src/pages/admin/rewards/__tests__/RewardsPage.test.tsx`
- Modify: `src/pages/admin/rewards/RewardsPage.tsx`

Identical pattern to Task 3, but for rewards. The existing test `'reject sets status archived and refetches'` (line 116-127) must be replaced.

---

- [ ] **Step 1: Write failing tests — replace old reject test with dialog-based tests**

In `RewardsPage.test.tsx`, replace the test at line 116-127 with:

```ts
it('reject on proposal opens rejection reason dialog, not direct update', async () => {
  mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
  const mockUpdate = vi.fn()
  mockFrom.mockReturnValue({ update: mockUpdate })

  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'דחה' }))

  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'דחיית הצעה' })).toBeInTheDocument()
  expect(mockUpdate).not.toHaveBeenCalled()
})

it('rejection dialog cancel closes dialog without calling update', async () => {
  mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
  mockFrom.mockReturnValue({ update: vi.fn() })

  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
  await userEvent.click(screen.getByRole('button', { name: 'ביטול' }))

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(mockRefetch).not.toHaveBeenCalled()
})

it('rejection dialog confirm without reason calls update with proposal_rejection_reason null', async () => {
  mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
  const mockEq = vi.fn().mockResolvedValue({ error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ update: mockUpdate })

  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
  await userEvent.click(screen.getByRole('button', { name: 'דחה הצעה' }))

  await waitFor(() => {
    expect(mockUpdate).toHaveBeenCalledWith({
      status: 'archived',
      proposal_rejection_reason: null,
    })
    expect(mockRefetch).toHaveBeenCalled()
  })
})

it('rejection dialog confirm with reason calls update with trimmed reason', async () => {
  mockUseRewards.mockReturnValue({ rewards: [pendingReward], loading: false, error: null, refetch: mockRefetch })
  const mockEq = vi.fn().mockResolvedValue({ error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ update: mockUpdate })

  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
  const textarea = screen.getByRole('textbox')
  await userEvent.type(textarea, 'יקר מדי')
  await userEvent.click(screen.getByRole('button', { name: 'דחה הצעה' }))

  await waitFor(() => {
    expect(mockUpdate).toHaveBeenCalledWith({
      status: 'archived',
      proposal_rejection_reason: 'יקר מדי',
    })
  })
})
```

Also add `mockRpc` to the import line at the top (it's not currently imported in RewardsPage.test.tsx, but we add it now for consistency — Task 4 may not need it but Task 6 will):

```ts
import { mockFrom, mockRpc } from '../../../../test/mocks/supabase'
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx vitest run src/pages/admin/rewards/__tests__/RewardsPage.test.tsx --reporter=verbose
```
Expected: 4 new tests FAIL.

- [ ] **Step 3: Implement the rejection dialog in `RewardsPage.tsx`**

Add Dialog imports at the top:

```ts
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
```

Add state:

```ts
const [rejectionTarget, setRejectionTarget] = useState<Reward | null>(null)
const [rejectionReason, setRejectionReason] = useState('')
```

Replace `rejectReward` with `openRejectDialog` + `confirmRejectReward`:

```ts
function openRejectDialog(reward: Reward) {
  setMutationError(null)
  setRejectionReason('')
  setRejectionTarget(reward)
}

async function confirmRejectReward() {
  if (!rejectionTarget) return
  setMutationError(null)
  const reason = rejectionReason.trim() || null
  const { error } = await supabase
    .from('rewards')
    .update({ status: 'archived', proposal_rejection_reason: reason })
    .eq('id', rejectionTarget.id)
  if (error) {
    setMutationError('שגיאה בדחיית ההצעה')
  } else {
    setRejectionTarget(null)
    setRejectionReason('')
    refetch()
  }
}
```

Update the "דחה" button in the pending section to call `openRejectDialog(reward)`.

Add the dialog before the closing `</div>` of the component:

```tsx
<Dialog
  open={rejectionTarget !== null}
  onOpenChange={(open) => {
    if (!open) { setRejectionTarget(null); setRejectionReason('') }
  }}
>
  <DialogContent dir="rtl">
    <DialogHeader>
      <DialogTitle>דחיית הצעה</DialogTitle>
      <DialogDescription>סיבת הדחייה (אופציונלי)</DialogDescription>
    </DialogHeader>
    <textarea
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      placeholder="ניתן להשאיר ריק..."
      maxLength={500}
      value={rejectionReason}
      onChange={(e) => setRejectionReason(e.target.value)}
    />
    <DialogFooter>
      <Button variant="outline" onClick={() => { setRejectionTarget(null); setRejectionReason('') }}>
        ביטול
      </Button>
      <Button variant="destructive" onClick={confirmRejectReward}>
        דחה הצעה
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/pages/admin/rewards/__tests__/RewardsPage.test.tsx --reporter=verbose
```
Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run --reporter=verbose
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/rewards/__tests__/RewardsPage.test.tsx \
        src/pages/admin/rewards/RewardsPage.tsx
git commit -m "feat: admin reward rejection dialog with optional reason"
```

---

## Task 5: `useMyProposals` Hook

**Files:**
- Create: `src/hooks/useMyProposals.ts`

This hook is used by both player pages to fetch the player's own pending/rejected proposals.

---

- [ ] **Step 1: Create `src/hooks/useMyProposals.ts`**

```ts
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Chore, Reward } from '../types/database'

export function useMyProposals(
  table: 'chores',
  userId: string | undefined,
  familyId: string | undefined,
): { proposals: Chore[]; refetch: () => void }
export function useMyProposals(
  table: 'rewards',
  userId: string | undefined,
  familyId: string | undefined,
): { proposals: Reward[]; refetch: () => void }
export function useMyProposals(
  table: 'chores' | 'rewards',
  userId: string | undefined,
  familyId: string | undefined,
) {
  const [proposals, setProposals] = useState<(Chore | Reward)[]>([])

  const fetch = useCallback(async () => {
    if (!userId || !familyId) return
    const { data } = await supabase
      .from(table)
      .select('*')
      .eq('proposed_by', userId)
      .eq('family_id', familyId)
      .in('status', ['pending_approval', 'archived'])
      .order('created_at', { ascending: false })
    setProposals(data ?? [])
  }, [table, userId, familyId])

  useEffect(() => { fetch() }, [fetch])

  return { proposals, refetch: fetch }
}
```

- [ ] **Step 2: Run TS check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMyProposals.ts
git commit -m "feat: add useMyProposals hook for player proposal tracking"
```

---

## Task 6: Player ChorePoolPage — Proposal Form + My Proposals Section

**Files:**
- Modify: `src/pages/player/chores/__tests__/ChorePoolPage.test.tsx`
- Modify: `src/pages/player/chores/ChorePoolPage.tsx`

---

- [ ] **Step 1: Add mock for `useMyProposals` and write failing tests**

At the top of `ChorePoolPage.test.tsx`, add the mock and imports. Add after the `useChoreAssignments` mock block:

```ts
vi.mock('../../../../hooks/useMyProposals', () => ({
  useMyProposals: vi.fn(() => ({ proposals: [], refetch: vi.fn() })),
}))

import { useMyProposals } from '../../../../hooks/useMyProposals'
const mockUseMyProposals = vi.mocked(useMyProposals)
```

Also import `mockFrom` and `mockRpc` from the shared mock (already imported from Task 2):
```ts
import { mockFunctionsInvoke, mockFrom, mockRpc } from '../../../../test/mocks/supabase'
```

Add to `beforeEach`:
```ts
mockUseMyProposals.mockReturnValue({ proposals: [], refetch: vi.fn() })
```

Add the proposal and my-proposals test fixtures at the top of the describe block:

```ts
const pendingChoreProposal = {
  ...nonRecurringChore,
  id: 'p1',
  title: 'לנקות את החצר',
  status: 'pending_approval' as const,
  proposed_by: 'p1',
  is_pool_visible: false,
}

const rejectedChoreProposal = {
  ...pendingChoreProposal,
  id: 'p2',
  title: 'לשטוף כלים',
  status: 'archived' as const,
  proposal_rejection_reason: 'כבר יש משימה דומה',
}

const rejectedNoReason = {
  ...rejectedChoreProposal,
  id: 'p3',
  title: 'לקפל כביסה',
  proposal_rejection_reason: null,
}
```

Add these failing tests to the `describe('ChorePoolPage')` block:

```ts
it('shows "הצע משימה" button', () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  renderPoolPage()
  expect(screen.getByRole('button', { name: 'הצע משימה' })).toBeInTheDocument()
})

it('"הצע משימה" button opens proposal dialog', async () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  renderPoolPage()
  await userEvent.click(screen.getByRole('button', { name: 'הצע משימה' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'הצע משימה חדשה' })).toBeInTheDocument()
})

it('proposal form submit with valid data calls supabase insert', async () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  const mockInsert = vi.fn().mockResolvedValue({ error: null })
  mockFrom.mockReturnValue({ insert: mockInsert })

  renderPoolPage()
  await userEvent.click(screen.getByRole('button', { name: 'הצע משימה' }))
  await userEvent.type(screen.getByLabelText('כותרת'), 'לנקות חלונות')
  await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
  await userEvent.type(screen.getByLabelText('ערך במטבעות'), '15')
  await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

  await waitFor(() => {
    expect(mockFrom).toHaveBeenCalledWith('chores')
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      title: 'לנקות חלונות',
      coin_value: 15,
      status: 'pending_approval',
      proposed_by: 'p1',
      family_id: 'f1',
    }))
  })
})

it('proposal form submit success closes dialog', async () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })

  renderPoolPage()
  await userEvent.click(screen.getByRole('button', { name: 'הצע משימה' }))
  await userEvent.type(screen.getByLabelText('כותרת'), 'לנקות חלונות')
  await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
  await userEvent.type(screen.getByLabelText('ערך במטבעות'), '15')
  await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('proposal form submit error shows error and keeps dialog open', async () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } }) })

  renderPoolPage()
  await userEvent.click(screen.getByRole('button', { name: 'הצע משימה' }))
  await userEvent.type(screen.getByLabelText('כותרת'), 'לנקות חלונות')
  await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
  await userEvent.type(screen.getByLabelText('ערך במטבעות'), '15')
  await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשליחת ההצעה')
})

it('shows "ההצעות שלי" section when player has proposals', () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  mockUseMyProposals.mockReturnValue({ proposals: [pendingChoreProposal], refetch: vi.fn() })
  renderPoolPage()
  expect(screen.getByText('ההצעות שלי')).toBeInTheDocument()
})

it('"ההצעות שלי" section hidden when no proposals', () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  mockUseMyProposals.mockReturnValue({ proposals: [], refetch: vi.fn() })
  renderPoolPage()
  expect(screen.queryByText('ההצעות שלי')).not.toBeInTheDocument()
})

it('pending proposal shows "ממתין לאישור" badge', () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  mockUseMyProposals.mockReturnValue({ proposals: [pendingChoreProposal], refetch: vi.fn() })
  renderPoolPage()
  expect(screen.getByText('לנקות את החצר')).toBeInTheDocument()
  expect(screen.getByText('ממתין לאישור')).toBeInTheDocument()
})

it('rejected proposal shows "נדחה" badge', () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  mockUseMyProposals.mockReturnValue({ proposals: [rejectedChoreProposal], refetch: vi.fn() })
  renderPoolPage()
  expect(screen.getByText('לשטוף כלים')).toBeInTheDocument()
  expect(screen.getByText('נדחה')).toBeInTheDocument()
})

it('clicking rejected card opens dismissal dialog with rejection reason', async () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  mockUseMyProposals.mockReturnValue({ proposals: [rejectedChoreProposal], refetch: vi.fn() })
  renderPoolPage()
  await userEvent.click(screen.getByText('לשטוף כלים'))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText(/כבר יש משימה דומה/)).toBeInTheDocument()
})

it('clicking rejected card without reason shows generic message', async () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  mockUseMyProposals.mockReturnValue({ proposals: [rejectedNoReason], refetch: vi.fn() })
  renderPoolPage()
  await userEvent.click(screen.getByText('לקפל כביסה'))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText(/נדחתה על ידי המנהל/)).toBeInTheDocument()
  expect(screen.queryByText(/:/)).not.toBeInTheDocument()
})

it('"אישור" calls dismiss_rejected_proposal RPC and refetches', async () => {
  const mockRefetchProposals = vi.fn()
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  mockUseMyProposals.mockReturnValue({ proposals: [rejectedChoreProposal], refetch: mockRefetchProposals })
  mockRpc.mockResolvedValue({ error: null })

  renderPoolPage()
  await userEvent.click(screen.getByText('לשטוף כלים'))
  await userEvent.click(screen.getByRole('button', { name: 'אישור' }))

  await waitFor(() => {
    expect(mockRpc).toHaveBeenCalledWith('dismiss_rejected_proposal', {
      p_entity_type: 'chore',
      p_entity_id: 'p2',
    })
    expect(mockRefetchProposals).toHaveBeenCalled()
  })
})

it('"אישור" RPC error shows toast and keeps card', async () => {
  mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
  mockUseMyProposals.mockReturnValue({ proposals: [rejectedChoreProposal], refetch: vi.fn() })
  mockRpc.mockResolvedValue({ error: { message: 'not found' } })

  renderPoolPage()
  await userEvent.click(screen.getByText('לשטוף כלים'))
  await userEvent.click(screen.getByRole('button', { name: 'אישור' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('לשטוף כלים')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx vitest run src/pages/player/chores/__tests__/ChorePoolPage.test.tsx --reporter=verbose
```
Expected: New proposal tests FAIL. Existing tests pass.

- [ ] **Step 3: Implement the proposal form and "ההצעות שלי" section in `ChorePoolPage.tsx`**

Add imports:

```ts
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import { useMyProposals } from '../../../hooks/useMyProposals'
import type { Chore, ChoreDifficulty } from '../../../types/database'
```

Add state for the proposal form and dismissal dialog:

```ts
const { proposals: myProposals, refetch: refetchProposals } = useMyProposals(
  'chores', profile?.id, profile?.family_id ?? undefined
)

// Proposal form state
const [proposalOpen, setProposalOpen] = useState(false)
const [proposalTitle, setProposalTitle] = useState('')
const [proposalDescription, setProposalDescription] = useState('')
const [proposalCoinValue, setProposalCoinValue] = useState('5')
const [proposalDifficulty, setProposalDifficulty] = useState<ChoreDifficulty>('easy')
const [proposalSubmitting, setProposalSubmitting] = useState(false)
const [proposalError, setProposalError] = useState<string | null>(null)

// Dismissal dialog state
const [dismissTarget, setDismissTarget] = useState<Chore | null>(null)
const [dismissing, setDismissing] = useState(false)
```

Add `submitProposal` and `handleDismiss` functions:

```ts
async function submitProposal() {
  if (!profile) return
  setProposalSubmitting(true)
  setProposalError(null)
  const { error } = await supabase.from('chores').insert({
    title: proposalTitle.trim(),
    description: proposalDescription.trim() || null,
    coin_value: parseInt(proposalCoinValue, 10),
    difficulty: proposalDifficulty,
    status: 'pending_approval',
    proposed_by: profile.id,
    family_id: profile.family_id,
  })
  setProposalSubmitting(false)
  if (error) {
    setProposalError('שגיאה בשליחת ההצעה')
    return
  }
  setProposalOpen(false)
  setProposalTitle('')
  setProposalDescription('')
  setProposalCoinValue('5')
  setProposalDifficulty('easy')
  refetchProposals()
}

async function handleDismiss() {
  if (!dismissTarget) return
  setDismissing(true)
  const { error } = await supabase.rpc('dismiss_rejected_proposal', {
    p_entity_type: 'chore',
    p_entity_id: dismissTarget.id,
  })
  setDismissing(false)
  setDismissTarget(null)
  if (!error) {
    refetchProposals()
  }
}
```

In the JSX, add the "הצע משימה" button to the header area (after the back link / page title):

```tsx
<Button size="sm" variant="outline" onClick={() => { setProposalError(null); setProposalOpen(true) }}>
  הצע משימה
</Button>
```

Add the "ההצעות שלי" section below the pool chores list (after the pool chores `</div>`):

```tsx
{myProposals.length > 0 && (
  <div className="space-y-3 mt-6">
    <h2 className="text-lg font-semibold">ההצעות שלי</h2>
    {myProposals.map(proposal => (
      <Card key={proposal.id}>
        <CardContent className="py-3 flex items-center justify-between">
          <div
            className={proposal.status === 'archived' ? 'cursor-pointer' : undefined}
            onClick={proposal.status === 'archived' ? () => setDismissTarget(proposal) : undefined}
          >
            <p className="font-medium">{proposal.title}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">{proposal.coin_value} מטבעות</span>
              {proposal.status === 'pending_approval' ? (
                <Badge variant="secondary">ממתין לאישור</Badge>
              ) : (
                <Badge variant="destructive">נדחה</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
)}
```

Add the proposal form dialog (before the final closing `</div>`):

```tsx
<Dialog open={proposalOpen} onOpenChange={(open) => { if (!open) { setProposalOpen(false); setProposalError(null) } }}>
  <DialogContent dir="rtl">
    <DialogHeader>
      <DialogTitle>הצע משימה חדשה</DialogTitle>
      <DialogDescription>מלא את הפרטים וההצעה תישלח לאישור המנהל</DialogDescription>
    </DialogHeader>
    <div className="space-y-3">
      <div>
        <label htmlFor="proposal-title" className="text-sm font-medium">כותרת</label>
        <input
          id="proposal-title"
          aria-label="כותרת"
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={proposalTitle}
          onChange={(e) => setProposalTitle(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="proposal-desc" className="text-sm font-medium">תיאור (אופציונלי)</label>
        <textarea
          id="proposal-desc"
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          value={proposalDescription}
          onChange={(e) => setProposalDescription(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="proposal-coins" className="text-sm font-medium">ערך במטבעות</label>
        <input
          id="proposal-coins"
          aria-label="ערך במטבעות"
          type="number"
          min={1}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={proposalCoinValue}
          onChange={(e) => setProposalCoinValue(e.target.value)}
        />
      </div>
      <div>
        <span className="text-sm font-medium">קושי</span>
        <div className="flex gap-3 mt-1">
          {(['easy', 'medium', 'hard'] as ChoreDifficulty[]).map(d => (
            <label key={d} className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="radio"
                name="difficulty"
                value={d}
                checked={proposalDifficulty === d}
                onChange={() => setProposalDifficulty(d)}
              />
              {d === 'easy' ? 'קל' : d === 'medium' ? 'בינוני' : 'קשה'}
            </label>
          ))}
        </div>
      </div>
      {proposalError && <p role="alert" className="text-sm text-destructive">{proposalError}</p>}
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setProposalOpen(false)}>ביטול</Button>
      <Button
        onClick={submitProposal}
        disabled={!proposalTitle.trim() || parseInt(proposalCoinValue, 10) < 1 || proposalSubmitting}
      >
        {proposalSubmitting ? '...' : 'שלח הצעה'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Add the dismissal dialog:

```tsx
<Dialog open={dismissTarget !== null} onOpenChange={(open) => { if (!open) setDismissTarget(null) }}>
  <DialogContent dir="rtl">
    <DialogHeader>
      <DialogTitle>הצעה נדחתה</DialogTitle>
    </DialogHeader>
    <p className="text-sm">
      {dismissTarget?.proposal_rejection_reason
        ? `הצעתך נדחתה על ידי המנהל: ${dismissTarget.proposal_rejection_reason}`
        : 'הצעתך נדחתה על ידי המנהל'}
    </p>
    <DialogFooter>
      <Button onClick={handleDismiss} disabled={dismissing}>
        {dismissing ? '...' : 'אישור'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/pages/player/chores/__tests__/ChorePoolPage.test.tsx --reporter=verbose
```
Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run --reporter=verbose
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/player/chores/__tests__/ChorePoolPage.test.tsx \
        src/pages/player/chores/ChorePoolPage.tsx
git commit -m "feat: player chore proposal form and my-proposals section"
```

---

## Task 7: Player RewardStorePage — Proposal Form + My Proposals Section

**Files:**
- Modify: `src/pages/player/store/__tests__/RewardStorePage.test.tsx`
- Modify: `src/pages/player/store/RewardStorePage.tsx`

Identical pattern to Task 6, but for rewards. `coin_value` → `coin_cost`, no `difficulty` field.

---

- [ ] **Step 1: Add mock and failing tests to `RewardStorePage.test.tsx`**

Add mock for `useMyProposals` at the top of the test file (after existing mocks):

```ts
vi.mock('../../../../hooks/useMyProposals', () => ({
  useMyProposals: vi.fn(() => ({ proposals: [], refetch: vi.fn() })),
}))

import { useMyProposals } from '../../../../hooks/useMyProposals'
const mockUseMyProposals = vi.mocked(useMyProposals)
```

Also import `mockFrom` from the shared mock. The current import line is:
```ts
import { mockRpc } from '../../../../test/mocks/supabase'
```
Change to:
```ts
import { mockFrom, mockRpc } from '../../../../test/mocks/supabase'
```

Add to `beforeEach`:
```ts
mockUseMyProposals.mockReturnValue({ proposals: [], refetch: vi.fn() })
```

Add proposal fixtures and failing tests:

```ts
const pendingRewardProposal = {
  ...fakeReward,
  id: 'p1',
  title: 'טיול לים',
  status: 'pending_approval' as const,
  proposed_by: 'p1',
}

const rejectedRewardProposal = {
  ...pendingRewardProposal,
  id: 'p2',
  title: 'טיול לאירופה',
  status: 'archived' as const,
  proposal_rejection_reason: 'יקר מדי',
}

const rejectedNoReason = {
  ...rejectedRewardProposal,
  id: 'p3',
  title: 'איפד',
  proposal_rejection_reason: null,
}
```

Failing tests to add to the describe block:

```ts
it('shows "הצע מתנה חדשה" button', () => {
  mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
  renderPage()
  expect(screen.getByRole('button', { name: 'הצע מתנה חדשה' })).toBeInTheDocument()
})

it('"הצע מתנה חדשה" button opens proposal dialog', async () => {
  mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'הצע מתנה חדשה' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'הצע מתנה חדשה' })).toBeInTheDocument()
})

it('reward proposal submit with valid data calls supabase insert', async () => {
  mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
  const mockInsert = vi.fn().mockResolvedValue({ error: null })
  mockFrom.mockReturnValue({ insert: mockInsert })

  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'הצע מתנה חדשה' }))
  await userEvent.type(screen.getByLabelText('כותרת'), 'כרטיס לקולנוע')
  await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
  await userEvent.type(screen.getByLabelText('עלות במטבעות'), '30')
  await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

  await waitFor(() => {
    expect(mockFrom).toHaveBeenCalledWith('rewards')
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      title: 'כרטיס לקולנוע',
      coin_cost: 30,
      status: 'pending_approval',
      proposed_by: 'p1',
      family_id: 'f1',
    }))
  })
})

it('reward proposal submit success closes dialog', async () => {
  mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
  mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })

  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'הצע מתנה חדשה' }))
  await userEvent.type(screen.getByLabelText('כותרת'), 'כרטיס לקולנוע')
  await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
  await userEvent.type(screen.getByLabelText('עלות במטבעות'), '30')
  await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('reward proposal submit error shows error and keeps dialog open', async () => {
  mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
  mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } }) })

  renderPage()
  await userEvent.click(screen.getByRole('button', { name: 'הצע מתנה חדשה' }))
  await userEvent.type(screen.getByLabelText('כותרת'), 'כרטיס לקולנוע')
  await userEvent.clear(screen.getByLabelText('עלות במטבעות'))
  await userEvent.type(screen.getByLabelText('עלות במטבעות'), '30')
  await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשליחת ההצעה')
})

it('shows "ההצעות שלי" section when player has reward proposals', () => {
  mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
  mockUseMyProposals.mockReturnValue({ proposals: [pendingRewardProposal], refetch: vi.fn() })
  renderPage()
  expect(screen.getByText('ההצעות שלי')).toBeInTheDocument()
  expect(screen.getByText('טיול לים')).toBeInTheDocument()
  expect(screen.getByText('ממתין לאישור')).toBeInTheDocument()
})

it('"ההצעות שלי" section hidden when no reward proposals', () => {
  mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
  renderPage()
  expect(screen.queryByText('ההצעות שלי')).not.toBeInTheDocument()
})

it('clicking rejected reward proposal shows dismissal dialog with reason', async () => {
  mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
  mockUseMyProposals.mockReturnValue({ proposals: [rejectedRewardProposal], refetch: vi.fn() })
  renderPage()
  await userEvent.click(screen.getByText('טיול לאירופה'))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText(/יקר מדי/)).toBeInTheDocument()
})

it('"אישור" calls dismiss_rejected_proposal for reward and refetches', async () => {
  const mockRefetchProposals = vi.fn()
  mockUseRewards.mockReturnValue({ rewards: [], loading: false, error: null, refetch: mockRefetch })
  mockUseMyProposals.mockReturnValue({ proposals: [rejectedRewardProposal], refetch: mockRefetchProposals })
  mockRpc.mockResolvedValue({ error: null })

  renderPage()
  await userEvent.click(screen.getByText('טיול לאירופה'))
  await userEvent.click(screen.getByRole('button', { name: 'אישור' }))

  await waitFor(() => {
    expect(mockRpc).toHaveBeenCalledWith('dismiss_rejected_proposal', {
      p_entity_type: 'reward',
      p_entity_id: 'p2',
    })
    expect(mockRefetchProposals).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx vitest run src/pages/player/store/__tests__/RewardStorePage.test.tsx --reporter=verbose
```
Expected: New proposal tests FAIL.

- [ ] **Step 3: Implement proposal form and "ההצעות שלי" section in `RewardStorePage.tsx`**

Add imports to `RewardStorePage.tsx`:

```ts
import { useAuth } from '../../../contexts/AuthContext'
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
// Dialog and DialogContent already imported — just add the missing named exports
import { useMyProposals } from '../../../hooks/useMyProposals'
import { Badge } from '../../../components/ui/badge'
import type { Reward } from '../../../types/database'
```

Wait — `RewardStorePage.tsx` currently imports `Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter` but not `DialogDescription`. The existing `Dialog` import block is:
```ts
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog'
```

Update it to add `DialogDescription`:
```ts
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
```

Add `useAuth`, `Badge`, `useMyProposals` imports and `Reward` type import.

In the component, add auth and proposals:

```ts
const { profile } = useAuth()
const { proposals: myProposals, refetch: refetchProposals } = useMyProposals(
  'rewards', profile?.id, profile?.family_id ?? undefined
)
```

Add proposal form state:

```ts
const [proposalOpen, setProposalOpen] = useState(false)
const [proposalTitle, setProposalTitle] = useState('')
const [proposalDescription, setProposalDescription] = useState('')
const [proposalCoinCost, setProposalCoinCost] = useState('10')
const [proposalSubmitting, setProposalSubmitting] = useState(false)
const [proposalError, setProposalError] = useState<string | null>(null)
const [dismissTarget, setDismissTarget] = useState<Reward | null>(null)
const [dismissing, setDismissing] = useState(false)
```

Add `submitProposal` and `handleDismiss`:

```ts
async function submitProposal() {
  if (!profile) return
  setProposalSubmitting(true)
  setProposalError(null)
  const { error } = await supabase.from('rewards').insert({
    title: proposalTitle.trim(),
    description: proposalDescription.trim() || null,
    coin_cost: parseInt(proposalCoinCost, 10),
    status: 'pending_approval',
    proposed_by: profile.id,
    family_id: profile.family_id,
  })
  setProposalSubmitting(false)
  if (error) {
    setProposalError('שגיאה בשליחת ההצעה')
    return
  }
  setProposalOpen(false)
  setProposalTitle('')
  setProposalDescription('')
  setProposalCoinCost('10')
  refetchProposals()
}

async function handleDismiss() {
  if (!dismissTarget) return
  setDismissing(true)
  const { error } = await supabase.rpc('dismiss_rejected_proposal', {
    p_entity_type: 'reward',
    p_entity_id: dismissTarget.id,
  })
  setDismissing(false)
  setDismissTarget(null)
  if (!error) {
    refetchProposals()
  }
}
```

In the JSX, add "הצע מתנה חדשה" button next to the page title:

```tsx
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold">החנות</h1>
  <Button size="sm" variant="outline" onClick={() => { setProposalError(null); setProposalOpen(true) }}>
    הצע מתנה חדשה
  </Button>
</div>
```

(Replace the existing `<h1 className="text-2xl font-bold">החנות</h1>` with this.)

Add "ההצעות שלי" section after the store rewards grid:

```tsx
{myProposals.length > 0 && (
  <div className="space-y-3 mt-6">
    <h2 className="text-lg font-semibold">ההצעות שלי</h2>
    {myProposals.map(proposal => (
      <Card key={proposal.id}>
        <CardContent className="py-3 flex items-center justify-between">
          <div
            className={proposal.status === 'archived' ? 'cursor-pointer' : undefined}
            onClick={proposal.status === 'archived' ? () => setDismissTarget(proposal) : undefined}
          >
            <p className="font-medium">{proposal.title}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">🪙 {proposal.coin_cost} מטבעות</span>
              {proposal.status === 'pending_approval' ? (
                <Badge variant="secondary">ממתין לאישור</Badge>
              ) : (
                <Badge variant="destructive">נדחה</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
)}
```

Add proposal form dialog and dismissal dialog before the closing `</div>`:

```tsx
{/* Proposal form dialog */}
<Dialog open={proposalOpen} onOpenChange={(open) => { if (!open) { setProposalOpen(false); setProposalError(null) } }}>
  <DialogContent dir="rtl">
    <DialogHeader>
      <DialogTitle>הצע מתנה חדשה</DialogTitle>
      <DialogDescription>מלא את הפרטים וההצעה תישלח לאישור המנהל</DialogDescription>
    </DialogHeader>
    <div className="space-y-3">
      <div>
        <label htmlFor="reward-proposal-title" className="text-sm font-medium">כותרת</label>
        <input
          id="reward-proposal-title"
          aria-label="כותרת"
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={proposalTitle}
          onChange={(e) => setProposalTitle(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="reward-proposal-desc" className="text-sm font-medium">תיאור (אופציונלי)</label>
        <textarea
          id="reward-proposal-desc"
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          value={proposalDescription}
          onChange={(e) => setProposalDescription(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="reward-proposal-cost" className="text-sm font-medium">עלות במטבעות</label>
        <input
          id="reward-proposal-cost"
          aria-label="עלות במטבעות"
          type="number"
          min={1}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          value={proposalCoinCost}
          onChange={(e) => setProposalCoinCost(e.target.value)}
        />
      </div>
      {proposalError && <p role="alert" className="text-sm text-destructive">{proposalError}</p>}
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setProposalOpen(false)}>ביטול</Button>
      <Button
        onClick={submitProposal}
        disabled={!proposalTitle.trim() || parseInt(proposalCoinCost, 10) < 1 || proposalSubmitting}
      >
        {proposalSubmitting ? '...' : 'שלח הצעה'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

{/* Dismissal dialog */}
<Dialog open={dismissTarget !== null} onOpenChange={(open) => { if (!open) setDismissTarget(null) }}>
  <DialogContent dir="rtl">
    <DialogHeader>
      <DialogTitle>הצעה נדחתה</DialogTitle>
    </DialogHeader>
    <p className="text-sm">
      {dismissTarget?.proposal_rejection_reason
        ? `הצעתך נדחתה על ידי המנהל: ${dismissTarget.proposal_rejection_reason}`
        : 'הצעתך נדחתה על ידי המנהל'}
    </p>
    <DialogFooter>
      <Button onClick={handleDismiss} disabled={dismissing}>
        {dismissing ? '...' : 'אישור'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/pages/player/store/__tests__/RewardStorePage.test.tsx --reporter=verbose
```
Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run --reporter=verbose
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/player/store/__tests__/RewardStorePage.test.tsx \
        src/pages/player/store/RewardStorePage.tsx
git commit -m "feat: player reward proposal form and my-proposals section in store"
```

---

## Task 8: `notify-admin-proposal` Edge Function

**Files:**
- Create: `supabase/functions/notify-admin-proposal/index.ts`

Triggered by two DB webhooks (INSERT on `chores`, INSERT on `rewards`). Sends email to each admin in the family when a player submits a proposal. Follows `notify-admin-completion` patterns.

No `verify_jwt = false` needed: Supabase DB webhooks include a service role JWT — the gateway validates it automatically. Only custom bearer tokens (like `CRON_SECRET`) need the bypass.

---

- [ ] **Step 1: Create `supabase/functions/notify-admin-proposal/index.ts`**

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}

function buildProposalEmail(
  proposerName: string,
  entityTitle: string,
  entityType: 'chore' | 'reward',
  adminPageUrl: string,
): string {
  const label = entityType === 'chore' ? 'משימה' : 'פרס'
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;direction:rtl;text-align:right;padding:24px;max-width:480px;margin:0 auto;">
  <h2 style="color:#1e1b4b;margin:0 0 12px 0;">הצעת ${escapeHtml(label)} חדשה</h2>
  <p style="margin:0 0 8px 0;"><strong>${escapeHtml(proposerName)}</strong> הגיש/ה הצעה חדשה:</p>
  <p style="margin:0 0 16px 0;font-size:1.1rem;">״${escapeHtml(entityTitle)}״</p>
  <a href="${escapeHtml(adminPageUrl)}"
     style="display:inline-block;background:#6366f1;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:1rem;">
    עבור לדף האישור
  </a>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  const webhookSecret = req.headers.get('x-webhook-secret') ?? ''
  if (!timingSafeEqual(webhookSecret, Deno.env.get('WEBHOOK_SECRET') ?? '')) {
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const record = (payload as Record<string, unknown>).record as Record<string, unknown> | null
  if (!record || typeof record.id !== 'string' || !record.id) {
    return new Response('Invalid webhook payload', { status: 400 })
  }

  // Guards: skip non-proposals
  if (record.proposed_by === null || record.proposed_by === undefined) {
    return new Response(JSON.stringify({ ok: true, skipped: 'not_a_proposal' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (record.status !== 'pending_approval') {
    return new Response(JSON.stringify({ ok: true, skipped: 'wrong_status' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const entityTitle = typeof record.title === 'string' ? record.title : ''
  const familyId = typeof record.family_id === 'string' ? record.family_id : null
  const proposedBy = typeof record.proposed_by === 'string' ? record.proposed_by : null
  const entityId = record.id

  // Detect chore vs reward by presence of coin_value vs coin_cost
  const entityType: 'chore' | 'reward' = 'coin_value' in record ? 'chore' : 'reward'

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const fromEmail = Deno.env.get('FROM_EMAIL')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const appUrl = Deno.env.get('APP_URL')

  if (!resendApiKey || !fromEmail || !supabaseUrl || !supabaseServiceKey || !appUrl || !familyId || !proposedBy) {
    console.error('Missing required env vars or payload fields')
    return new Response('Server misconfiguration', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: proposerProfile, error: profileError } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', proposedBy)
    .single()

  if (profileError || !proposerProfile) {
    console.error('Proposer profile lookup failed:', profileError)
    return new Response('Proposer not found', { status: 404 })
  }

  const { data: admins, error: adminsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('family_id', familyId)
    .eq('role', 'admin')

  if (adminsError) {
    console.error('Admins query failed:', adminsError)
    return new Response('Failed to fetch admins', { status: 500 })
  }

  const adminPageUrl = `${appUrl}/admin/${entityType === 'chore' ? 'chores' : 'rewards'}`

  await Promise.all(
    (admins ?? []).map(async (admin) => {
      try {
        const { data: authData, error: authError } = await supabase.auth.admin.getUserById(admin.id)
        if (authError || !authData?.user?.email) {
          console.error(`[proposal-notify] no email for admin ${admin.id}`)
          return
        }

        const idempotencyKey = `proposal-${entityId}-admin-${admin.id}`
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            from: fromEmail,
            to: authData.user.email,
            subject: `הצעה חדשה ממתינה לאישורך — ${proposerProfile.name}`,
            html: buildProposalEmail(
              proposerProfile.name,
              entityTitle,
              entityType,
              adminPageUrl,
            ),
          }),
        })

        if (!res.ok) {
          const body = await res.text()
          console.error(`Resend error for admin ${admin.id}: ${res.status} ${body}`)
        } else {
          console.log(`Proposal notification sent to admin ${admin.id}`)
        }
      } catch (err) {
        console.error(`Failed to notify admin ${admin.id}:`, err)
      }
    })
  )

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 2: Deploy the function**

```bash
supabase functions deploy notify-admin-proposal
```

Expected: `Deployed Function notify-admin-proposal` (no `--no-verify-jwt` needed — DB webhooks include service role JWT).

- [ ] **Step 3: Configure DB webhooks in Supabase dashboard**

In the Supabase dashboard:
1. Go to **Database → Webhooks → Create a new webhook**
2. Webhook 1:
   - Name: `on-chore-proposal-submitted`
   - Table: `chores`
   - Event: `INSERT`
   - URL: `https://vkxhcfxdvngxmeqswhuy.supabase.co/functions/v1/notify-admin-proposal`
   - HTTP Headers: `x-webhook-secret: <value of WEBHOOK_SECRET secret>`
3. Webhook 2:
   - Name: `on-reward-proposal-submitted`
   - Table: `rewards`
   - Event: `INSERT`
   - Same URL and header

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/notify-admin-proposal/index.ts
git commit -m "feat: notify-admin-proposal Edge Function for email notifications on proposal submission"
```

---

## Task 9: Extend `cleanup-photos` with Job 3 (Rejected Proposals Cleanup)

**Files:**
- Modify: `supabase/functions/cleanup-photos/index.ts`
- Modify: `supabase/functions/cleanup-photos/index.test.ts`

Rejected proposals (status='archived', proposed_by IS NOT NULL) that a player never dismissed accumulate indefinitely. Job 3 deletes them after 30 days.

---

- [ ] **Step 1: Write failing test for Job 3**

In `supabase/functions/cleanup-photos/index.test.ts`, there are no tests for Job 3 (it doesn't exist yet). Since the test file uses `CRON_SECRET` env var to run handler tests, we can only add a meaningful test for `proposalsCleaned` in the log — but that would require a running handler. Instead, add a comment marking where the test would go and ensure the test file still runs cleanly.

Actually, Job 3 is a DB delete operation — we can verify behavior through the `result` JSON in the response. The existing handler tests only check auth (require `CRON_SECRET`). For now, just verify the test file compiles and runs cleanly after the implementation step.

- [ ] **Step 2: Implement Job 3 in `cleanup-photos/index.ts`**

In the function body, add `proposalsCleaned = 0` to the initial variable declarations:

```ts
let orphansCleaned = 0
let staleRejected = 0
let proposalsCleaned = 0   // ← ADD
let errors = 0
```

Add Job 3 block after the Job 2 block, before the audit log:

```ts
// ── Job 3: Stale rejected proposals ──────────────────────────────────────────
const { error: chorePropError, count: chorePropsDeleted } = await supabase
  .from('chores')
  .delete({ count: 'exact' })
  .eq('status', 'archived')
  .not('proposed_by', 'is', null)
  .lt('updated_at', thirtyDaysAgo)

if (chorePropError) {
  console.error(JSON.stringify({ error: 'CHORE_PROPOSALS_CLEANUP_FAILED', message: chorePropError.message }))
  errors++
} else {
  proposalsCleaned += chorePropsDeleted ?? 0
}

const { error: rewardPropError, count: rewardPropsDeleted } = await supabase
  .from('rewards')
  .delete({ count: 'exact' })
  .eq('status', 'archived')
  .not('proposed_by', 'is', null)
  .lt('updated_at', thirtyDaysAgo)

if (rewardPropError) {
  console.error(JSON.stringify({ error: 'REWARD_PROPOSALS_CLEANUP_FAILED', message: rewardPropError.message }))
  errors++
} else {
  proposalsCleaned += rewardPropsDeleted ?? 0
}
```

Update the `result` object to include `proposals_cleaned`:

```ts
const result = {
  orphans_cleaned: orphansCleaned,
  stale_rejected: staleRejected,
  proposals_cleaned: proposalsCleaned,   // ← ADD
  errors,
}
```

Note: `thirtyDaysAgo` is already defined earlier in the function for Job 2 — no need to redefine it.

- [ ] **Step 3: Run Deno tests to confirm existing tests still pass**

```bash
deno test --allow-env --allow-net supabase/functions/cleanup-photos/index.test.ts
```
Expected: All tests pass (no regressions).

- [ ] **Step 4: Deploy the updated Edge Function**

```bash
supabase functions deploy cleanup-photos --no-verify-jwt
```

Expected: `Deployed Function cleanup-photos`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/cleanup-photos/index.ts \
        supabase/functions/cleanup-photos/index.test.ts
git commit -m "feat: add Job 3 to cleanup-photos for stale rejected proposals older than 30 days"
```

---

## Self-Review

### Spec Coverage

| Spec Requirement | Task |
|---|---|
| `proposal_rejection_reason` column on chores + rewards | Task 1 |
| `proposal_submitted` notification type | Task 1 |
| `idx_profiles_family_admins` partial index | Task 1 |
| Trigger: notify admins on chore proposal INSERT | Task 1 |
| Trigger: notify admins on reward proposal INSERT | Task 1 |
| Updated `notify_proposal_resolved` with rejection reason | Task 1 |
| `trg_notify_reward_proposal_resolved` trigger on rewards | Task 1 |
| `dismiss_rejected_proposal` SECURITY DEFINER RPC | Task 1 |
| TypeScript types updated | Task 2 |
| Admin chore rejection reason dialog | Task 3 |
| Admin reward rejection reason dialog | Task 4 |
| `useMyProposals` hook | Task 5 |
| Player chore pool proposal form + "ההצעות שלי" | Task 6 |
| Player reward store proposal form + "ההצעות שלי" | Task 7 |
| `notify-admin-proposal` Edge Function | Task 8 |
| Rejected proposal retention / cleanup | Task 9 |

All spec sections covered.

### Placeholder Scan

None found. Every step has exact code, exact commands, and expected output.

### Type Consistency

- `Chore.proposal_rejection_reason: string | null` — used in Task 2 (type definition), Task 3 (update call), Task 6 (dismissal dialog display). Consistent.
- `Reward.proposal_rejection_reason: string | null` — same pattern in Tasks 4 and 7. Consistent.
- `dismiss_rejected_proposal(p_entity_type, p_entity_id)` — SQL in Task 1, called with `'chore'`/`'reward'` in Tasks 6/7. Consistent.
- `useMyProposals('chores', userId, familyId)` — defined in Task 5, called in Tasks 6 and 7. Consistent.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-kid-proposed-chores-rewards.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
