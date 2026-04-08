# Family Onboarding & Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a new admin to create a family via `/signup`, invite family members via QR/link, display family identity (avatar + alias) in both layouts, and let all members vote in real-time on alias changes.

**Architecture:** DB-first — 3 new tables, 8 new RPCs, and 2 notification type values are added via migration 013. React hooks (`useFamily`, `useInvites`, `useAliasVote`) consume data via Supabase client + realtime. Shared UI components (`FamilyAvatarUpload`, `AliasProposalDialog`, `AliasVoteBanner`) are dropped into both `AdminLayout` and `PlayerLayout`.

**Tech Stack:** React + TypeScript + Supabase (auth, postgres, realtime, storage), shadcn/ui, `browser-image-compression` (already installed), `qrcode.react` (to install), Vitest + @testing-library/react

---

## File Map

| File | Action |
|---|---|
| `supabase/migrations/013_family_onboarding.sql` | Create |
| `src/types/database.ts` | Modify |
| `src/test/mocks/supabase.ts` | Modify (add `mockSignUp`) |
| `src/hooks/useFamily.ts` | Create |
| `src/hooks/__tests__/useFamily.test.ts` | Create |
| `src/hooks/useInvites.ts` | Create |
| `src/hooks/__tests__/useInvites.test.ts` | Create |
| `src/pages/SignupPage.tsx` | Create |
| `src/pages/JoinPage.tsx` | Create |
| `src/pages/LoginPage.tsx` | Modify (add signup link) |
| `src/router.tsx` | Modify (add /signup, /join routes) |
| `src/components/admin/InviteDialog.tsx` | Create |
| `src/components/admin/__tests__/InviteDialog.test.tsx` | Create |
| `src/components/shared/FamilyAvatarUpload.tsx` | Create |
| `src/components/shared/__tests__/FamilyAvatarUpload.test.tsx` | Create |
| `src/components/layout/AdminLayout.tsx` | Modify (family name/avatar + AliasVoteBanner) |
| `src/components/layout/PlayerLayout.tsx` | Modify (family name/avatar + AliasVoteBanner) |
| `src/pages/admin/players/PlayersPage.tsx` | Modify (InviteDialog + pending invites + family settings) |
| `src/pages/player/profile/ProfilePage.tsx` | Modify (family avatar card + alias proposal) |
| `src/hooks/useAliasVote.ts` | Create |
| `src/hooks/__tests__/useAliasVote.test.ts` | Create |
| `src/components/shared/AliasProposalDialog.tsx` | Create |
| `src/components/shared/__tests__/AliasProposalDialog.test.tsx` | Create |
| `src/components/shared/AliasVoteBanner.tsx` | Create |
| `src/components/shared/__tests__/AliasVoteBanner.test.tsx` | Create |

---

## Task 1: Setup — install qrcode.react + extend supabase mock

**Files:**
- `package.json` (via npm)
- Modify: `src/test/mocks/supabase.ts`

- [ ] **Step 1: Install qrcode.react**

```bash
cd D:/Claude_Projects/family-chores
npm install qrcode.react
```

Expected: package added to `node_modules` and `package.json`.

- [ ] **Step 2: Add `mockSignUp` to the supabase mock**

Open `src/test/mocks/supabase.ts`. Replace the entire file with:

```typescript
import { vi } from 'vitest'

const {
  mockGetSession,
  mockSignInWithPassword,
  mockSignUp,
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
    mockSignUp: vi.fn(),
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
      signUp: mockSignUp,
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
  mockSignUp,
  mockSignOut,
  mockOnAuthStateChange,
  mockFrom,
  mockRpc,
  mockStorageFrom,
  mockChannel,
  mockRemoveChannel,
}
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
npx vitest run
```

Expected: All existing tests pass (no regressions from mock change).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/test/mocks/supabase.ts
git commit -m "chore: install qrcode.react, add mockSignUp to supabase mock"
```

---

## Task 2: Database Migration 013 — tables, RPCs, storage bucket

**Files:**
- Create: `supabase/migrations/013_family_onboarding.sql`

> **Note:** After creating this file, apply it to your Supabase project via the Supabase dashboard SQL editor or Supabase CLI (`supabase db push`). No automated tests for SQL.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/013_family_onboarding.sql` with the following content:

```sql
-- ============================================================
-- PART 1: Extend notification_type enum
-- ============================================================
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'alias_vote_requested';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'alias_vote_resolved';

-- ============================================================
-- PART 2: Extend families table
-- ============================================================
ALTER TABLE families ADD COLUMN IF NOT EXISTS team_name  TEXT NULL;
ALTER TABLE families ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL;

-- Allow admins to update their own family row
CREATE POLICY "families: admins can update their own family"
  ON families FOR UPDATE
  USING (id = get_my_family_id() AND is_admin());

-- ============================================================
-- PART 3: family_invites table
-- ============================================================
CREATE TABLE IF NOT EXISTS family_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        user_role NOT NULL DEFAULT 'player',
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ NULL,
  used_by     UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE family_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family_invites: admins can view their family invites"
  ON family_invites FOR SELECT
  USING (family_id = get_my_family_id() AND is_admin());

CREATE POLICY "family_invites: admins can insert invites"
  ON family_invites FOR INSERT
  WITH CHECK (family_id = get_my_family_id() AND is_admin());

CREATE POLICY "family_invites: admins can delete their family invites"
  ON family_invites FOR DELETE
  USING (family_id = get_my_family_id() AND is_admin());

-- ============================================================
-- PART 4: RPCs — invite flow
-- ============================================================

-- generate_invite_token: admin creates a new single-use invite
CREATE OR REPLACE FUNCTION generate_invite_token(p_role user_role)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_token     text;
  v_family_id uuid;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can generate invite tokens';
  END IF;
  v_family_id := get_my_family_id();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'No family found for current user';
  END IF;
  v_token := encode(gen_random_bytes(16), 'hex');
  INSERT INTO family_invites (family_id, created_by, role, token, expires_at)
  VALUES (v_family_id, auth.uid(), p_role, v_token, now() + interval '5 hours');
  RETURN v_token;
END;
$$;

-- validate_invite_token: public — returns family info or error reason
CREATE OR REPLACE FUNCTION validate_invite_token(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invite      family_invites%ROWTYPE;
  v_family      families%ROWTYPE;
  v_inviter_name text;
BEGIN
  SELECT * INTO v_invite FROM family_invites WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'reason', 'not_found');
  END IF;
  IF v_invite.used_at IS NOT NULL THEN
    RETURN json_build_object('valid', false, 'reason', 'used');
  END IF;
  IF v_invite.expires_at < now() THEN
    RETURN json_build_object('valid', false, 'reason', 'expired');
  END IF;
  SELECT * INTO v_family FROM families WHERE id = v_invite.family_id;
  SELECT name INTO v_inviter_name FROM profiles WHERE id = v_invite.created_by;
  RETURN json_build_object(
    'valid',       true,
    'family_name', v_family.name,
    'team_name',   v_family.team_name,
    'invited_by',  v_inviter_name
  );
END;
$$;

-- redeem_invite: called after auth.signUp succeeds; creates profile atomically
CREATE OR REPLACE FUNCTION redeem_invite(p_token text, p_name text, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invite family_invites%ROWTYPE;
BEGIN
  SELECT * INTO v_invite FROM family_invites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found';
  END IF;
  IF v_invite.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_already_used';
  END IF;
  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'invite_expired';
  END IF;
  INSERT INTO profiles (id, family_id, name, role)
  VALUES (p_user_id, v_invite.family_id, p_name, v_invite.role);
  UPDATE family_invites SET used_at = now(), used_by = p_user_id WHERE id = v_invite.id;
END;
$$;

-- create_family_and_admin: called after auth.signUp for self-service admin signup
CREATE OR REPLACE FUNCTION create_family_and_admin(
  p_family_name text,
  p_team_name   text,
  p_admin_name  text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id uuid;
  v_team_name text;
BEGIN
  v_team_name := NULLIF(TRIM(p_team_name), '');
  INSERT INTO families (name, team_name)
  VALUES (p_family_name, v_team_name)
  RETURNING id INTO v_family_id;

  INSERT INTO profiles (id, family_id, name, role)
  VALUES (auth.uid(), v_family_id, p_admin_name, 'admin');
END;
$$;

-- ============================================================
-- PART 5: Alias voting tables
-- ============================================================
CREATE TABLE IF NOT EXISTS family_alias_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  proposed_by     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  proposed_alias  TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_at     TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS family_alias_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  UUID NOT NULL REFERENCES family_alias_proposals(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vote         BOOLEAN NOT NULL,
  voted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_id, user_id)
);

ALTER TABLE family_alias_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_alias_votes     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alias_proposals: family members can view"
  ON family_alias_proposals FOR SELECT
  USING (family_id = get_my_family_id());

CREATE POLICY "alias_votes: family members can view"
  ON family_alias_votes FOR SELECT
  USING (
    proposal_id IN (
      SELECT id FROM family_alias_proposals WHERE family_id = get_my_family_id()
    )
  );

CREATE POLICY "alias_votes: members can insert their own vote"
  ON family_alias_votes FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- PART 6: Alias voting RPCs
-- ============================================================

-- check_alias_vote_outcome: internal helper — resolves early if majority reached
CREATE OR REPLACE FUNCTION check_alias_vote_outcome(p_proposal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_proposal   family_alias_proposals%ROWTYPE;
  v_total      int;
  v_yes        int;
  v_no         int;
  v_threshold  int;
BEGIN
  SELECT * INTO v_proposal FROM family_alias_proposals WHERE id = p_proposal_id;
  IF NOT FOUND OR v_proposal.status <> 'pending' THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_total FROM profiles       WHERE family_id    = v_proposal.family_id;
  SELECT COUNT(*) INTO v_yes  FROM family_alias_votes WHERE proposal_id = p_proposal_id AND vote = true;
  SELECT COUNT(*) INTO v_no   FROM family_alias_votes WHERE proposal_id = p_proposal_id AND vote = false;
  v_threshold := v_total / 2;  -- integer division: 4→2, 3→1, 2→1

  IF v_yes > v_threshold THEN
    UPDATE family_alias_proposals
      SET status = 'accepted', resolved_at = now()
      WHERE id = p_proposal_id;
    UPDATE families SET team_name = v_proposal.proposed_alias WHERE id = v_proposal.family_id;
    INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
    SELECT p.id, v_proposal.family_id, 'alias_vote_resolved',
           'כינוי המשפחה עודכן',
           'הכינוי החדש "' || v_proposal.proposed_alias || '" התקבל ברוב קולות',
           p_proposal_id
    FROM profiles p WHERE p.family_id = v_proposal.family_id;

  ELSIF v_no >= v_total - v_yes THEN  -- remaining votes can't flip result
    UPDATE family_alias_proposals
      SET status = 'rejected', resolved_at = now()
      WHERE id = p_proposal_id;
    INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
    SELECT p.id, v_proposal.family_id, 'alias_vote_resolved',
           'הצעת הכינוי נדחתה',
           'ההצעה לכינוי "' || v_proposal.proposed_alias || '" לא קיבלה רוב',
           p_proposal_id
    FROM profiles p WHERE p.family_id = v_proposal.family_id;
  END IF;
END;
$$;

-- propose_alias_change: any family member can open a vote
CREATE OR REPLACE FUNCTION propose_alias_change(p_new_alias text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_family_id   uuid;
  v_proposal_id uuid;
BEGIN
  v_family_id := get_my_family_id();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'No family found for current user';
  END IF;

  IF EXISTS (
    SELECT 1 FROM family_alias_proposals
    WHERE family_id = v_family_id AND status = 'pending' AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'active_proposal_exists';
  END IF;

  INSERT INTO family_alias_proposals (family_id, proposed_by, proposed_alias, expires_at)
  VALUES (v_family_id, auth.uid(), p_new_alias, now() + interval '1 hour')
  RETURNING id INTO v_proposal_id;

  -- Proposer auto-votes yes
  INSERT INTO family_alias_votes (proposal_id, user_id, vote)
  VALUES (v_proposal_id, auth.uid(), true);

  -- Resolve immediately for single-member family edge case
  PERFORM check_alias_vote_outcome(v_proposal_id);

  -- Notify all other family members
  INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
  SELECT p.id, v_family_id, 'alias_vote_requested',
         'הצבעה על כינוי משפחה חדש',
         'הוצע לשנות את הכינוי ל"' || p_new_alias || '"',
         v_proposal_id
  FROM profiles p WHERE p.family_id = v_family_id AND p.id <> auth.uid();
END;
$$;

-- cast_alias_vote: any family member casts their vote
CREATE OR REPLACE FUNCTION cast_alias_vote(p_proposal_id uuid, p_vote boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_proposal family_alias_proposals%ROWTYPE;
BEGIN
  SELECT * INTO v_proposal FROM family_alias_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;
  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal_not_pending';
  END IF;
  IF v_proposal.expires_at < now() THEN
    RAISE EXCEPTION 'proposal_expired';
  END IF;

  INSERT INTO family_alias_votes (proposal_id, user_id, vote)
  VALUES (p_proposal_id, auth.uid(), p_vote);
  -- UNIQUE constraint prevents double-voting at DB level

  PERFORM check_alias_vote_outcome(p_proposal_id);
END;
$$;

-- resolve_alias_proposal: called by client after 1-hour timer expires; idempotent
CREATE OR REPLACE FUNCTION resolve_alias_proposal(p_proposal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_proposal family_alias_proposals%ROWTYPE;
BEGIN
  SELECT * INTO v_proposal FROM family_alias_proposals WHERE id = p_proposal_id;
  IF NOT FOUND OR v_proposal.status <> 'pending' THEN RETURN; END IF;
  IF v_proposal.expires_at > now() THEN
    RAISE EXCEPTION 'proposal_not_expired_yet';
  END IF;

  -- Time's up: no majority reached → reject
  UPDATE family_alias_proposals
    SET status = 'rejected', resolved_at = now()
    WHERE id = p_proposal_id;

  INSERT INTO notifications (user_id, family_id, type, title_he, body_he, related_entity_id)
  SELECT p.id, v_proposal.family_id, 'alias_vote_resolved',
         'הצעת הכינוי נדחתה',
         'ההצעה לכינוי "' || v_proposal.proposed_alias || '" לא קיבלה רוב',
         p_proposal_id
  FROM profiles p WHERE p.family_id = v_proposal.family_id;
END;
$$;

-- ============================================================
-- PART 7: Storage bucket for family avatars
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'family-avatars',
  'family-avatars',
  true,
  1048576,  -- 1 MB server-side limit (post-compression)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "family-avatars: members can read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'family-avatars'
    AND (storage.foldername(name))[1] = get_my_family_id()::text
  );

CREATE POLICY "family-avatars: members can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'family-avatars'
    AND (storage.foldername(name))[1] = get_my_family_id()::text
  );

CREATE POLICY "family-avatars: members can update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'family-avatars'
    AND (storage.foldername(name))[1] = get_my_family_id()::text
  );
```

- [ ] **Step 2: Apply the migration to Supabase**

In the Supabase dashboard → SQL editor, run the contents of `013_family_onboarding.sql`.
Alternatively: `supabase db push` if using Supabase CLI.

Verify in Supabase dashboard:
- `families` has `team_name` and `avatar_url` columns
- `family_invites`, `family_alias_proposals`, `family_alias_votes` tables exist
- RPCs appear in Database → Functions
- `family-avatars` bucket appears in Storage

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/013_family_onboarding.sql
git commit -m "feat: add migration 013 — family invites, alias voting, storage bucket"
```

---

## Task 3: Update TypeScript types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Update `NotificationType` and add new interfaces**

In `src/types/database.ts`, make these changes:

**1. Extend `NotificationType` union** (add the two new values):

```typescript
export type NotificationType =
  | 'chore_assigned' | 'completion_reviewed' | 'trade_received' | 'trade_resolved'
  | 'redemption_resolved' | 'proposal_resolved' | 'penalty_applied' | 'achievement_earned'
  | 'reminder' | 'alias_vote_requested' | 'alias_vote_resolved'
```

**2. Add `team_name` and `avatar_url` to `Family`:**

```typescript
export interface Family {
  id: string
  name: string
  team_name: string | null
  avatar_url: string | null
  created_at: string
}
```

**3. Append these new interfaces after the existing `Feedback` interface:**

```typescript
export interface FamilyInvite {
  id: string
  family_id: string
  created_by: string
  role: UserRole
  token: string
  expires_at: string
  used_at: string | null
  used_by: string | null
  created_at: string
}

export interface FamilyAliasProposal {
  id: string
  family_id: string
  proposed_by: string
  proposed_alias: string
  expires_at: string
  status: 'pending' | 'accepted' | 'rejected'
  resolved_at: string | null
  created_at: string
}

export interface FamilyAliasVote {
  id: string
  proposal_id: string
  user_id: string
  vote: boolean
  voted_at: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add Family fields, FamilyInvite, FamilyAliasProposal, FamilyAliasVote types"
```

---

## Task 4: `useFamily` hook

**Files:**
- Create: `src/hooks/useFamily.ts`
- Create: `src/hooks/__tests__/useFamily.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/useFamily.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom } from '../../test/mocks/supabase'
import type { Family } from '../../types/database'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'user1',
      family_id: 'fam1',
      name: 'דנה',
      avatar_url: null,
      role: 'player' as const,
      trust_level: 1,
      coin_balance: 0,
      created_at: '',
      updated_at: '',
    },
  }),
}))

const fakeFamily: Family = {
  id: 'fam1',
  name: 'משפחת כהן',
  team_name: 'כהן השולטים',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
}

function setupFetchMock(data: Family | null, error: { message: string } | null = null) {
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: error ? null : data, error }),
  })
}

import { useFamily } from '../useFamily'

describe('useFamily', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useFamily())
    expect(result.current.loading).toBe(true)
    expect(result.current.family).toBeNull()
  })

  it('fetches family on mount', async () => {
    setupFetchMock(fakeFamily)
    const { result } = renderHook(() => useFamily())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.family).toEqual(fakeFamily)
  })

  it('returns null family when fetch fails', async () => {
    setupFetchMock(null, { message: 'not found' })
    const { result } = renderHook(() => useFamily())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.family).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/useFamily.test.ts
```

Expected: FAIL — `useFamily` module not found.

- [ ] **Step 3: Implement `useFamily`**

Create `src/hooks/useFamily.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Family } from '../types/database'

interface UseFamilyResult {
  family: Family | null
  loading: boolean
}

export function useFamily(): UseFamilyResult {
  const { profile } = useAuth()
  const [family, setFamily] = useState<Family | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchFamily = useCallback(async () => {
    if (!profile?.family_id) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('families')
      .select('*')
      .eq('id', profile.family_id)
      .single()
    if (!mountedRef.current) return
    if (error) console.error('Failed to fetch family:', error.message)
    setFamily((data as Family) ?? null)
    setLoading(false)
  }, [profile?.family_id])

  useEffect(() => { fetchFamily() }, [fetchFamily])

  return { family, loading }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/__tests__/useFamily.test.ts
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFamily.ts src/hooks/__tests__/useFamily.test.ts
git commit -m "feat: add useFamily hook"
```

---

## Task 5: `useInvites` hook

**Files:**
- Create: `src/hooks/useInvites.ts`
- Create: `src/hooks/__tests__/useInvites.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/useInvites.test.ts`:

```typescript
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockRpc } from '../../test/mocks/supabase'
import type { FamilyInvite } from '../../types/database'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'admin1',
      family_id: 'fam1',
      name: 'יוסי',
      avatar_url: null,
      role: 'admin' as const,
      trust_level: 5,
      coin_balance: 0,
      created_at: '',
      updated_at: '',
    },
  }),
}))

const futureDate = new Date(Date.now() + 3_600_000).toISOString()
const pastDate   = new Date(Date.now() - 3_600_000).toISOString()

const activeInvite: FamilyInvite = {
  id: 'inv1',
  family_id: 'fam1',
  created_by: 'admin1',
  role: 'player',
  token: 'abc123',
  expires_at: futureDate,
  used_at: null,
  used_by: null,
  created_at: '2026-04-08T10:00:00Z',
}

const expiredInvite: FamilyInvite = {
  ...activeInvite,
  id: 'inv2',
  expires_at: pastDate,
}

function setupFetchMock(rows: FamilyInvite[]) {
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  })
}

import { useInvites } from '../useInvites'

describe('useInvites', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useInvites())
    expect(result.current.loading).toBe(true)
    expect(result.current.invites).toEqual([])
  })

  it('fetches active invites and filters out expired ones', async () => {
    setupFetchMock([activeInvite, expiredInvite])
    const { result } = renderHook(() => useInvites())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.invites).toHaveLength(1)
    expect(result.current.invites[0].id).toBe('inv1')
  })

  it('cancelInvite deletes row and removes from list', async () => {
    setupFetchMock([activeInvite])
    const { result } = renderHook(() => useInvites())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockFrom.mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    await act(async () => { await result.current.cancelInvite('inv1') })
    expect(result.current.invites).toEqual([])
  })

  it('generateInvite calls generate_invite_token RPC and returns token', async () => {
    setupFetchMock([])
    const { result } = renderHook(() => useInvites())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockRpc.mockResolvedValueOnce({ data: 'newtoken123', error: null })

    let token: string | undefined
    await act(async () => { token = await result.current.generateInvite('player') })
    expect(mockRpc).toHaveBeenCalledWith('generate_invite_token', { p_role: 'player' })
    expect(token).toBe('newtoken123')
  })

  it('generateInvite throws on RPC error', async () => {
    setupFetchMock([])
    const { result } = renderHook(() => useInvites())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })

    await expect(
      act(async () => { await result.current.generateInvite('admin') })
    ).rejects.toThrow('permission denied')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/useInvites.test.ts
```

Expected: FAIL — `useInvites` module not found.

- [ ] **Step 3: Implement `useInvites`**

Create `src/hooks/useInvites.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { FamilyInvite, UserRole } from '../types/database'

interface UseInvitesResult {
  invites: FamilyInvite[]
  loading: boolean
  refetch: () => void
  cancelInvite: (id: string) => Promise<void>
  generateInvite: (role: UserRole) => Promise<string>
}

export function useInvites(): UseInvitesResult {
  const { profile } = useAuth()
  const [invites, setInvites] = useState<FamilyInvite[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchInvites = useCallback(async () => {
    if (!profile?.family_id) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('family_invites')
      .select('*')
      .eq('family_id', profile.family_id)
      .is('used_at', null)
      .order('created_at', { ascending: false })
    if (!mountedRef.current) return
    if (error) console.error('Failed to fetch invites:', error.message)
    const now = new Date()
    const active = ((data as FamilyInvite[]) ?? []).filter(
      inv => new Date(inv.expires_at) > now
    )
    setInvites(active)
    setLoading(false)
  }, [profile?.family_id])

  useEffect(() => { fetchInvites() }, [fetchInvites])

  const cancelInvite = useCallback(async (id: string) => {
    const { error } = await supabase.from('family_invites').delete().eq('id', id)
    if (error) { console.error('Failed to cancel invite:', error.message); return }
    if (mountedRef.current) setInvites(prev => prev.filter(inv => inv.id !== id))
  }, [])

  const generateInvite = useCallback(async (role: UserRole): Promise<string> => {
    const { data, error } = await supabase.rpc('generate_invite_token', { p_role: role })
    if (error) throw new Error(error.message)
    return data as string
  }, [])

  return { invites, loading, refetch: fetchInvites, cancelInvite, generateInvite }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/__tests__/useInvites.test.ts
```

Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useInvites.ts src/hooks/__tests__/useInvites.test.ts
git commit -m "feat: add useInvites hook"
```

---

## Task 6: SignupPage, JoinPage, routes, and LoginPage link

**Files:**
- Create: `src/pages/SignupPage.tsx`
- Create: `src/pages/JoinPage.tsx`
- Modify: `src/pages/LoginPage.tsx`
- Modify: `src/router.tsx`

> Pages are tested via `npx tsc --noEmit` for type safety. Runtime behavior is verified manually.

- [ ] **Step 1: Create `SignupPage.tsx`**

Create `src/pages/SignupPage.tsx`:

```typescript
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'

export default function SignupPage() {
  const navigate = useNavigate()
  const [familyName, setFamilyName] = useState('')
  const [teamName, setTeamName]     = useState('')
  const [adminName, setAdminName]   = useState('')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError || !data.user) {
      setError(signUpError?.message ?? 'שגיאה ביצירת החשבון')
      setLoading(false)
      return
    }

    const { error: rpcError } = await supabase.rpc('create_family_and_admin', {
      p_family_name: familyName,
      p_team_name:   teamName,
      p_admin_name:  adminName,
    })
    if (rpcError) {
      setError(rpcError.message)
      setLoading(false)
      return
    }

    navigate('/admin')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-xl">יצירת משפחה חדשה</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              placeholder="שם המשפחה (למשל: משפחת כהן)"
              value={familyName}
              onChange={e => setFamilyName(e.target.value)}
              required
              aria-label="שם המשפחה"
            />
            <Input
              placeholder="כינוי המשפחה — אופציונלי (למשל: כהן השולטים)"
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              aria-label="כינוי המשפחה"
            />
            <Input
              placeholder="השם שלך"
              value={adminName}
              onChange={e => setAdminName(e.target.value)}
              required
              aria-label="השם שלך"
            />
            <Input
              type="email"
              placeholder="אימייל"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              aria-label="אימייל"
            />
            <Input
              type="password"
              placeholder="סיסמה"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              aria-label="סיסמה"
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'יוצר...' : 'צור משפחה'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              כבר יש לך חשבון?{' '}
              <Link to="/login" className="underline">כניסה</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create `JoinPage.tsx`**

Create `src/pages/JoinPage.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'

interface ValidateResult {
  valid: boolean
  family_name?: string
  team_name?: string | null
  invited_by?: string
  reason?: string
}

export default function JoinPage() {
  const navigate = useNavigate()
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const [validation, setValidation]   = useState<ValidateResult | null>(null)
  const [validating, setValidating]   = useState(true)
  const [name, setName]               = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setValidation({ valid: false, reason: 'not_found' })
      setValidating(false)
      return
    }
    supabase.rpc('validate_invite_token', { p_token: token })
      .then(({ data }) => {
        setValidation(data as ValidateResult)
        setValidating(false)
      })
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
    if (signUpError || !data.user) {
      setError(signUpError?.message ?? 'שגיאה ביצירת החשבון')
      setLoading(false)
      return
    }

    const { error: rpcError } = await supabase.rpc('redeem_invite', {
      p_token:   token,
      p_name:    name,
      p_user_id: data.user.id,
    })
    if (rpcError) {
      setError('הקישור כבר נוצל או שפג תוקפו')
      setLoading(false)
      return
    }

    navigate('/')
  }

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <p role="status" className="text-muted-foreground">בודק קישור...</p>
      </div>
    )
  }

  if (!validation?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center">
            <p role="alert" className="text-destructive font-medium">
              הקישור אינו תקף או שפג תוקפו — בקש מהמנהל קישור חדש
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-xl">
            הוזמת על ידי {validation.invited_by} למשפחת {validation.family_name}
            {validation.team_name ? ` — ${validation.team_name}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              placeholder="שם מלא"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              aria-label="שם מלא"
            />
            <Input
              type="email"
              placeholder="אימייל"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              aria-label="אימייל"
            />
            <Input
              type="password"
              placeholder="סיסמה"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              aria-label="סיסמה"
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'מצטרף...' : 'הצטרף'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Add signup link to `LoginPage.tsx`**

In `src/pages/LoginPage.tsx`, find the section near the bottom of the form and add a link after the submit button. The current file ends the `<form>` before a closing `</Card>`. Add after the `<Button type="submit">` line:

```typescript
<p className="text-center text-sm text-muted-foreground">
  משפחה חדשה?{' '}
  <Link to="/signup" className="underline">צור חשבון</Link>
</p>
```

Also add the `Link` import at the top if not already present:

```typescript
import { Link } from 'react-router-dom'
```

- [ ] **Step 4: Add `/signup` and `/join` routes to `router.tsx`**

In `src/router.tsx`, add these two imports at the top:

```typescript
import SignupPage from './pages/SignupPage'
import JoinPage from './pages/JoinPage'
```

Then add two new route entries in the router array, **before** the `{ path: '/' }` catch-all:

```typescript
{
  path: '/signup',
  element: <SignupPage />,
},
{
  path: '/join',
  element: <JoinPage />,
},
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SignupPage.tsx src/pages/JoinPage.tsx src/pages/LoginPage.tsx src/router.tsx
git commit -m "feat: add signup and join pages + routes + login page link"
```

---

## Task 7: `InviteDialog` component

**Files:**
- Create: `src/components/admin/InviteDialog.tsx`
- Create: `src/components/admin/__tests__/InviteDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/admin/__tests__/InviteDialog.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import InviteDialog from '../InviteDialog'

// qrcode.react renders a canvas/svg — stub it in tests
vi.mock('qrcode.react', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qrcode">{value}</div>,
}))

const mockGenerateInvite = vi.fn()

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  generateInvite: mockGenerateInvite,
}

describe('InviteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Stub window.location.origin used when VITE_APP_URL is undefined
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost:5173' },
      writable: true,
    })
  })

  it('renders role selection step with two role cards', () => {
    render(<InviteDialog {...defaultProps} />)
    expect(screen.getByText('שחקן')).toBeInTheDocument()
    expect(screen.getByText('מנהל משותף')).toBeInTheDocument()
    expect(screen.getByText('צור קישור')).toBeInTheDocument()
  })

  it('calls generateInvite with selected role on submit', async () => {
    mockGenerateInvite.mockResolvedValue('tok123')
    render(<InviteDialog {...defaultProps} />)

    fireEvent.click(screen.getByText('צור קישור'))
    expect(mockGenerateInvite).toHaveBeenCalledWith('player')
  })

  it('shows QR code and invite URL after successful generation', async () => {
    mockGenerateInvite.mockResolvedValue('tok123')
    render(<InviteDialog {...defaultProps} />)

    fireEvent.click(screen.getByText('צור קישור'))

    await waitFor(() => {
      expect(screen.getByTestId('qrcode')).toBeInTheDocument()
      expect(screen.getByText(/tok123/)).toBeInTheDocument()
      expect(screen.getByText('הקישור תקף ל-5 שעות')).toBeInTheDocument()
    })
  })

  it('renders admin role option when selected', async () => {
    mockGenerateInvite.mockResolvedValue('admintok')
    render(<InviteDialog {...defaultProps} />)

    fireEvent.click(screen.getByText('מנהל משותף'))
    fireEvent.click(screen.getByText('צור קישור'))

    expect(mockGenerateInvite).toHaveBeenCalledWith('admin')
  })

  it('resets to role step when "צור קישור חדש" is clicked', async () => {
    mockGenerateInvite.mockResolvedValue('tok999')
    render(<InviteDialog {...defaultProps} />)

    fireEvent.click(screen.getByText('צור קישור'))
    await waitFor(() => screen.getByText('צור קישור חדש'))

    fireEvent.click(screen.getByText('צור קישור חדש'))
    expect(screen.getByText('צור קישור')).toBeInTheDocument()
    expect(screen.queryByTestId('qrcode')).not.toBeInTheDocument()
  })

  it('shows error message when generateInvite throws', async () => {
    mockGenerateInvite.mockRejectedValue(new Error('permission denied'))
    render(<InviteDialog {...defaultProps} />)

    fireEvent.click(screen.getByText('צור קישור'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('permission denied')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/admin/__tests__/InviteDialog.test.tsx
```

Expected: FAIL — `InviteDialog` module not found.

- [ ] **Step 3: Set the `VITE_APP_URL` environment variable**

Add to `.env.local` (create if it doesn't exist):

```
VITE_APP_URL=http://localhost:5173
```

For Vercel production: add `VITE_APP_URL=https://your-app.vercel.app` in the Vercel dashboard under Project Settings → Environment Variables.

This value is used to build invite URLs. If not set, the component falls back to `window.location.origin`.

- [ ] **Step 4: Implement `InviteDialog`**

Create `src/components/admin/InviteDialog.tsx`:

```typescript
import { useState } from 'react'
import QRCode from 'qrcode.react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import type { UserRole } from '../../types/database'

interface InviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  generateInvite: (role: UserRole) => Promise<string>
}

export default function InviteDialog({ open, onOpenChange, generateInvite }: InviteDialogProps) {
  const [step, setStep]               = useState<'role' | 'link'>('role')
  const [selectedRole, setSelectedRole] = useState<UserRole>('player')
  const [inviteUrl, setInviteUrl]     = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [copied, setCopied]           = useState(false)

  function reset() {
    setStep('role')
    setSelectedRole('player')
    setInviteUrl('')
    setError(null)
    setCopied(false)
  }

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      const token  = await generateInvite(selectedRole)
      const appUrl = (import.meta.env.VITE_APP_URL as string | undefined) ?? window.location.origin
      setInviteUrl(`${appUrl}/join?token=${token}`)
      setStep('link')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) reset(); onOpenChange(open) }}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>הזמן בן משפחה</DialogTitle>
        </DialogHeader>

        {step === 'role' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {(['player', 'admin'] as UserRole[]).map(role => (
                <button
                  key={role}
                  onClick={() => setSelectedRole(role)}
                  className={`p-3 rounded-lg border-2 text-center transition-colors ${
                    selectedRole === role ? 'border-primary bg-primary/10' : 'border-muted'
                  }`}
                >
                  <p className="font-medium">{role === 'player' ? 'שחקן' : 'מנהל משותף'}</p>
                  <p className="text-xs text-muted-foreground">{role === 'player' ? 'ילד' : 'הורה'}</p>
                </button>
              ))}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={handleGenerate} disabled={loading}>
              {loading ? 'יוצר קישור...' : 'צור קישור'}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <QRCode value={inviteUrl} size={160} />
            </div>
            <p className="text-xs text-muted-foreground text-center break-all">{inviteUrl}</p>
            <p className="text-xs text-muted-foreground text-center">הקישור תקף ל-5 שעות</p>
            <Button variant="outline" className="w-full" onClick={handleCopy} aria-label="העתק קישור">
              {copied ? 'הועתק!' : 'העתק קישור'}
            </Button>
            <Button variant="ghost" className="w-full" onClick={reset}>
              צור קישור חדש
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/components/admin/__tests__/InviteDialog.test.tsx
```

Expected: PASS — 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/InviteDialog.tsx src/components/admin/__tests__/InviteDialog.test.tsx
git commit -m "feat: add InviteDialog component with QR code and role selection"
```

---

## Task 8: `FamilyAvatarUpload` component

**Files:**
- Create: `src/components/shared/FamilyAvatarUpload.tsx`
- Create: `src/components/shared/__tests__/FamilyAvatarUpload.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/shared/__tests__/FamilyAvatarUpload.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../../test/mocks/supabase'
import { mockFrom, mockStorageFrom } from '../../../test/mocks/supabase'
import type { Family } from '../../../types/database'

vi.mock('browser-image-compression', () => ({
  default: vi.fn().mockImplementation((file: File) => Promise.resolve(file)),
}))

const fakeFamily: Family = {
  id: 'fam1',
  name: 'משפחת כהן',
  team_name: 'כהן השולטים',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
}

function makeFile(name: string, type: string, sizeBytes: number): File {
  const buf = new ArrayBuffer(sizeBytes)
  return new File([buf], name, { type })
}

import FamilyAvatarUpload from '../FamilyAvatarUpload'

describe('FamilyAvatarUpload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders avatar and upload button', () => {
    render(<FamilyAvatarUpload family={fakeFamily} />)
    expect(screen.getByRole('button', { name: /שנה תמונה/i })).toBeInTheDocument()
  })

  it('shows error for unsupported file type', async () => {
    render(<FamilyAvatarUpload family={fakeFamily} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('photo.gif', 'image/gif', 1000)
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('סוג קובץ לא נתמך')
    })
  })

  it('shows error for file over 5MB', async () => {
    render(<FamilyAvatarUpload family={fakeFamily} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('big.jpg', 'image/jpeg', 6 * 1024 * 1024)
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('הקובץ גדול מדי')
    })
  })

  it('uploads file and calls onUploaded with public URL', async () => {
    const onUploaded = vi.fn()

    const storageObj = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/fam1/avatar.jpg' } }),
    }
    mockStorageFrom.mockReturnValue(storageObj)

    mockFrom.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    render(<FamilyAvatarUpload family={fakeFamily} onUploaded={onUploaded} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('photo.jpg', 'image/jpeg', 100_000)
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith('https://cdn.example.com/fam1/avatar.jpg')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/shared/__tests__/FamilyAvatarUpload.test.tsx
```

Expected: FAIL — `FamilyAvatarUpload` module not found.

- [ ] **Step 3: Implement `FamilyAvatarUpload`**

Create `src/components/shared/FamilyAvatarUpload.tsx`:

```typescript
import { useRef, useState } from 'react'
import imageCompression from 'browser-image-compression'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import type { Family } from '../../types/database'

interface FamilyAvatarUploadProps {
  family: Family
  onUploaded?: (url: string) => void
}

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES     = 5 * 1024 * 1024 // 5 MB

export default function FamilyAvatarUpload({ family, onUploaded }: FamilyAvatarUploadProps) {
  const inputRef             = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError]    = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)

    if (!ALLOWED_TYPES.has(file.type)) {
      setError('סוג קובץ לא נתמך — יש להעלות תמונה בפורמט JPG, PNG או WebP')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('הקובץ גדול מדי — הגודל המרבי הוא 5MB')
      return
    }

    setUploading(true)
    try {
      const compressed = await imageCompression(file, { maxSizeMB: 0.5, useWebWorker: true })
      const path       = `${family.id}/avatar.jpg`

      const { error: uploadError } = await supabase.storage
        .from('family-avatars')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('family-avatars')
        .getPublicUrl(path)

      const { error: dbError } = await supabase
        .from('families')
        .update({ avatar_url: publicUrl })
        .eq('id', family.id)
      if (dbError) throw dbError

      onUploaded?.(publicUrl)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Avatar
        className="h-16 w-16 cursor-pointer"
        onClick={() => inputRef.current?.click()}
      >
        <AvatarImage src={family.avatar_url ?? undefined} />
        <AvatarFallback>{family.name[0]}</AvatarFallback>
      </Avatar>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
        aria-label="העלה תמונת משפחה"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? 'מעלה...' : 'שנה תמונה'}
      </Button>
      {error && <p role="alert" className="text-xs text-destructive text-center">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/shared/__tests__/FamilyAvatarUpload.test.tsx
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/FamilyAvatarUpload.tsx src/components/shared/__tests__/FamilyAvatarUpload.test.tsx
git commit -m "feat: add FamilyAvatarUpload component"
```

---

## Task 9: Layout updates — family avatar and name in headers

**Files:**
- Modify: `src/components/layout/AdminLayout.tsx`
- Modify: `src/components/layout/PlayerLayout.tsx`

- [ ] **Step 1: Update `AdminLayout.tsx`**

Replace the entire file content of `src/components/layout/AdminLayout.tsx` with:

```typescript
import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useFamily } from '../../hooks/useFamily'
import { Button } from '../ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'

export default function AdminLayout() {
  const { profile, signOut } = useAuth()
  const { family } = useFamily()

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={profile?.avatar_url ?? undefined} />
            <AvatarFallback>{profile?.name?.[0] ?? 'א'}</AvatarFallback>
          </Avatar>
          <span className="font-semibold">{profile?.name}</span>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">מנהל</span>
          {family && (
            <div className="flex items-center gap-2 border-r pr-3 mr-1">
              <Avatar className="h-7 w-7">
                <AvatarImage src={family.avatar_url ?? undefined} />
                <AvatarFallback>{family.name[0]}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-medium">{family.name}</span>
                {family.team_name && (
                  <span className="text-xs text-muted-foreground">{family.team_name}</span>
                )}
              </div>
            </div>
          )}
        </div>
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
          <NavLink
            to="/admin/completions"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            הגשות
          </NavLink>
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
          <NavLink
            to="/admin/calendar"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            לוח שבועי
          </NavLink>
          <NavLink
            to="/admin/feedback"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            משוב
          </NavLink>
          <NavLink
            to="/admin/players"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm font-medium transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
            }
          >
            שחקנים
          </NavLink>
        </nav>
        <Button variant="outline" size="sm" onClick={signOut}>
          יציאה
        </Button>
      </header>
      <main className="p-4 max-w-7xl mx-auto">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Update `PlayerLayout.tsx`**

In `src/components/layout/PlayerLayout.tsx`, add the `useFamily` import and render the family identity in the header.

Replace the top-level imports and the `PlayerLayout` component header section:

Add import after the existing imports:
```typescript
import { useFamily } from '../../hooks/useFamily'
```

After the existing hook calls (`useToast`, `useNotifications`), add:
```typescript
const { family } = useFamily()
```

Then in the JSX header, after the closing `</Link>` for the player profile section (the Link that wraps Avatar + player name + coins), add:

```typescript
{family && (
  <div className="hidden sm:flex items-center gap-2 border-r pr-3 mr-1">
    <Avatar className="h-7 w-7">
      <AvatarImage src={family.avatar_url ?? undefined} />
      <AvatarFallback>{family.name[0]}</AvatarFallback>
    </Avatar>
    <div className="flex flex-col leading-tight">
      <span className="text-xs font-medium">{family.name}</span>
      {family.team_name && (
        <span className="text-xs text-muted-foreground">{family.team_name}</span>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/AdminLayout.tsx src/components/layout/PlayerLayout.tsx
git commit -m "feat: show family avatar and name in AdminLayout and PlayerLayout headers"
```

---

## Task 10: PlayersPage — invite UI, pending invites list, family settings card

**Files:**
- Modify: `src/pages/admin/players/PlayersPage.tsx`

> The `PlayersPage` gains three new sections: an invite button (opens `InviteDialog`), a pending invites list, and a family settings card (avatar upload + alias read-only display).

- [ ] **Step 1: Rewrite `PlayersPage.tsx`**

Replace the entire file `src/pages/admin/players/PlayersPage.tsx` with:

```typescript
import { useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useFamilyMembers } from '../../../hooks/useFamilyMembers'
import { useInvites } from '../../../hooks/useInvites'
import { useFamily } from '../../../hooks/useFamily'
import { supabase } from '../../../lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Button } from '../../../components/ui/button'
import { Badge } from '../../../components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/avatar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Input } from '../../../components/ui/input'
import InviteDialog from '../../../components/admin/InviteDialog'
import FamilyAvatarUpload from '../../../components/shared/FamilyAvatarUpload'
import type { Profile } from '../../../types/database'

export default function PlayersPage() {
  const { profile: adminProfile }         = useAuth()
  const { members, loading, error, refetch } = useFamilyMembers()
  const { invites, cancelInvite, generateInvite } = useInvites()
  const { family, loading: familyLoading } = useFamily()

  const [actionError, setActionError]     = useState<string | null>(null)
  const [busyId, setBusyId]               = useState<string | null>(null)
  const [bonusTarget, setBonusTarget]     = useState<Profile | null>(null)
  const [bonusAmount, setBonusAmount]     = useState('')
  const [bonusSubmitting, setBonusSubmitting] = useState(false)
  const [inviteOpen, setInviteOpen]       = useState(false)

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

  function formatCreatedAt(createdAt: string) {
    const d = new Date(createdAt)
    return d.toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  if (loading) return <div role="status" className="text-muted-foreground py-8 text-center">טוען...</div>

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ניהול שחקנים</h1>
        <Button onClick={() => setInviteOpen(true)}>הזמן בן משפחה</Button>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      {/* Players list */}
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
                  size="sm" variant="outline"
                  disabled={(player.trust_level ?? 1) <= 1 || busyId === player.id}
                  onClick={() => handleTrustChange(player, -1)}
                  aria-label={`הורד רמת אמון של ${player.name}`}
                >−</Button>
                <Badge variant="secondary">{player.trust_level}</Badge>
                <Button
                  size="sm" variant="outline"
                  disabled={(player.trust_level ?? 1) >= 5 || busyId === player.id}
                  onClick={() => handleTrustChange(player, 1)}
                  aria-label={`העלה רמת אמון של ${player.name}`}
                >+</Button>
              </div>
              <Button size="sm" variant="secondary" onClick={() => { setBonusTarget(player); setBonusAmount('') }}>
                מענק בונוס
              </Button>
            </CardContent>
          </Card>
        ))}
        {players.length === 0 && (
          <p className="text-muted-foreground text-sm">אין שחקנים במשפחה.</p>
        )}
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">הזמנות פעילות</h2>
          {invites.map(inv => (
            <Card key={inv.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm">{inv.role === 'player' ? 'שחקן' : 'מנהל משותף'}</p>
                  <p className="text-xs text-muted-foreground">נוצר: {formatCreatedAt(inv.created_at)}</p>
                </div>
                <Button variant="destructive" size="sm" onClick={() => cancelInvite(inv.id)}>
                  בטל
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Family settings */}
      {!familyLoading && family && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">הגדרות משפחה</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <FamilyAvatarUpload family={family} />
              <div>
                <p className="font-medium">{family.name}</p>
                <p className="text-sm text-muted-foreground">
                  {family.team_name ?? 'עדיין לא נבחר כינוי'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bonus dialog */}
      <Dialog open={!!bonusTarget} onOpenChange={open => { if (!open) setBonusTarget(null) }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>מענק בונוס ל{bonusTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="number" min="1"
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

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        generateInvite={generateInvite}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run existing PlayersPage tests**

```bash
npx vitest run src/pages/admin/players/__tests__/
```

Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/players/PlayersPage.tsx
git commit -m "feat: add invite button, pending invites list, and family settings to PlayersPage"
```

---

## Task 11: ProfilePage — family avatar card

**Files:**
- Modify: `src/pages/player/profile/ProfilePage.tsx`

- [ ] **Step 1: Update `ProfilePage.tsx`**

Add the following imports at the top of `src/pages/player/profile/ProfilePage.tsx`:

```typescript
import { useFamily } from '../../../hooks/useFamily'
import FamilyAvatarUpload from '../../../components/shared/FamilyAvatarUpload'
```

After the existing hook calls (`useAchievements`, `useCoinTransactions`), add:

```typescript
const { family, loading: familyLoading } = useFamily()
```

Then add a new card section **before** the tab bar in the JSX (after the player header `<div className="flex flex-col items-center...">` section):

```typescript
{/* Family card */}
{!familyLoading && family && (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className="text-sm">המשפחה שלי</CardTitle>
    </CardHeader>
    <CardContent className="flex items-center gap-4">
      <FamilyAvatarUpload family={family} />
      <div>
        <p className="font-medium text-sm">{family.name}</p>
        <p className="text-xs text-muted-foreground">
          {family.team_name ?? 'עדיין לא נבחר כינוי'}
        </p>
      </div>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run existing ProfilePage tests**

```bash
npx vitest run src/pages/player/profile/__tests__/
```

Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/player/profile/ProfilePage.tsx
git commit -m "feat: add family avatar card to ProfilePage"
```

---

## Task 12: `useAliasVote` hook

**Files:**
- Create: `src/hooks/useAliasVote.ts`
- Create: `src/hooks/__tests__/useAliasVote.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/useAliasVote.test.ts`:

```typescript
import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../test/mocks/supabase'
import { mockFrom, mockRpc, mockChannel } from '../../test/mocks/supabase'
import type { FamilyAliasProposal, FamilyAliasVote } from '../../types/database'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      id: 'user1', family_id: 'fam1', name: 'דנה',
      avatar_url: null, role: 'player' as const, trust_level: 1,
      coin_balance: 0, created_at: '', updated_at: '',
    },
  }),
}))

const futureDate = new Date(Date.now() + 3_600_000).toISOString()

const fakeProposal: FamilyAliasProposal = {
  id: 'prop1',
  family_id: 'fam1',
  proposed_by: 'user2',
  proposed_alias: 'כהן השולטים',
  expires_at: futureDate,
  status: 'pending',
  resolved_at: null,
  created_at: '2026-04-08T10:00:00Z',
}

const fakeVote: FamilyAliasVote = {
  id: 'vote1',
  proposal_id: 'prop1',
  user_id: 'user2',
  vote: true,
  voted_at: '2026-04-08T10:00:01Z',
}

function setupNoProposalMock() {
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
}

function setupProposalMock(proposal: FamilyAliasProposal, votes: FamilyAliasVote[]) {
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: proposal, error: null }),
  })
  mockFrom.mockReturnValueOnce({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: votes, error: null }),
  })
}

import { useAliasVote } from '../useAliasVote'

describe('useAliasVote', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state', () => {
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnValue(new Promise(() => {})),
    })
    const { result } = renderHook(() => useAliasVote())
    expect(result.current.loading).toBe(true)
    expect(result.current.proposal).toBeNull()
  })

  it('returns null proposal when none pending', async () => {
    setupNoProposalMock()
    const { result } = renderHook(() => useAliasVote())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.proposal).toBeNull()
    expect(result.current.votes).toEqual([])
  })

  it('fetches pending proposal and its votes', async () => {
    setupProposalMock(fakeProposal, [fakeVote])
    const { result } = renderHook(() => useAliasVote())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.proposal).toEqual(fakeProposal)
    expect(result.current.votes).toEqual([fakeVote])
  })

  it('castVote calls cast_alias_vote RPC', async () => {
    setupProposalMock(fakeProposal, [fakeVote])
    const { result } = renderHook(() => useAliasVote())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockRpc.mockResolvedValueOnce({ error: null })
    await act(async () => { await result.current.castVote(true) })

    expect(mockRpc).toHaveBeenCalledWith('cast_alias_vote', {
      p_proposal_id: 'prop1',
      p_vote: true,
    })
  })

  it('castVote throws on RPC error', async () => {
    setupProposalMock(fakeProposal, [fakeVote])
    const { result } = renderHook(() => useAliasVote())
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockRpc.mockResolvedValueOnce({ error: { message: 'already voted' } })
    await expect(
      act(async () => { await result.current.castVote(false) })
    ).rejects.toThrow('already voted')
  })

  it('cleans up realtime channel on unmount', async () => {
    setupNoProposalMock()
    const mockRemoveChannel = vi.fn()
    const { unmount } = renderHook(() => useAliasVote())
    await waitFor(() => expect(mockChannel).toHaveBeenCalled())
    unmount()
    // Channel cleanup verified via supabase.removeChannel being called
    expect(mockChannel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/useAliasVote.test.ts
```

Expected: FAIL — `useAliasVote` module not found.

- [ ] **Step 3: Implement `useAliasVote`**

Create `src/hooks/useAliasVote.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { FamilyAliasProposal, FamilyAliasVote } from '../types/database'

interface UseAliasVoteResult {
  proposal: FamilyAliasProposal | null
  votes: FamilyAliasVote[]
  castVote: (vote: boolean) => Promise<void>
  resolveIfExpired: () => Promise<void>
  loading: boolean
}

export function useAliasVote(): UseAliasVoteResult {
  const { profile } = useAuth()
  const [proposal, setProposal] = useState<FamilyAliasProposal | null>(null)
  const [votes, setVotes]       = useState<FamilyAliasVote[]>([])
  const [loading, setLoading]   = useState(true)
  const mountedRef               = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchProposal = useCallback(async () => {
    if (!profile?.family_id) {
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('family_alias_proposals')
      .select('*')
      .eq('family_id', profile.family_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!mountedRef.current) return
    if (error) console.error('Failed to fetch alias proposal:', error.message)
    const active = data as FamilyAliasProposal | null
    setProposal(active)

    if (active) {
      const { data: votesData, error: votesError } = await supabase
        .from('family_alias_votes')
        .select('*')
        .eq('proposal_id', active.id)
      if (!mountedRef.current) return
      if (votesError) console.error('Failed to fetch alias votes:', votesError.message)
      setVotes((votesData as FamilyAliasVote[]) ?? [])
    } else {
      setVotes([])
    }
    setLoading(false)
  }, [profile?.family_id])

  useEffect(() => { fetchProposal() }, [fetchProposal])

  useEffect(() => {
    if (!profile?.family_id) return
    const channel = supabase
      .channel(`alias-vote-${profile.family_id}`)
      .on('postgres_changes' as const, {
        event: '*', schema: 'public', table: 'family_alias_proposals',
        filter: `family_id=eq.${profile.family_id}`,
      }, () => { fetchProposal() })
      .on('postgres_changes' as const, {
        event: '*', schema: 'public', table: 'family_alias_votes',
      }, () => { fetchProposal() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.family_id, fetchProposal])

  // Poll every minute to trigger resolve when timer expires
  useEffect(() => {
    if (!proposal) return
    const interval = setInterval(() => {
      if (new Date(proposal.expires_at) < new Date()) {
        resolveIfExpired()
      }
    }, 60_000)
    return () => clearInterval(interval)
  }, [proposal?.expires_at])  // eslint-disable-line react-hooks/exhaustive-deps

  const castVote = useCallback(async (vote: boolean) => {
    if (!proposal) return
    const { error } = await supabase.rpc('cast_alias_vote', {
      p_proposal_id: proposal.id,
      p_vote: vote,
    })
    if (error) throw new Error(error.message)
  }, [proposal?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const resolveIfExpired = useCallback(async () => {
    if (!proposal) return
    const { error } = await supabase.rpc('resolve_alias_proposal', {
      p_proposal_id: proposal.id,
    })
    if (error) console.error('Failed to resolve alias proposal:', error.message)
  }, [proposal?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  return { proposal, votes, castVote, resolveIfExpired, loading }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/__tests__/useAliasVote.test.ts
```

Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAliasVote.ts src/hooks/__tests__/useAliasVote.test.ts
git commit -m "feat: add useAliasVote hook with realtime subscription"
```

---

## Task 13: `AliasProposalDialog` component

**Files:**
- Create: `src/components/shared/AliasProposalDialog.tsx`
- Create: `src/components/shared/__tests__/AliasProposalDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/shared/__tests__/AliasProposalDialog.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../../test/mocks/supabase'
import { mockRpc } from '../../../test/mocks/supabase'
import type { FamilyAliasProposal } from '../../../types/database'

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  currentAlias: 'כהן הראשונים',
  activeProposal: null as FamilyAliasProposal | null,
  onProposed: vi.fn(),
}

import AliasProposalDialog from '../AliasProposalDialog'

describe('AliasProposalDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows input form when no active proposal', () => {
    render(<AliasProposalDialog {...defaultProps} />)
    expect(screen.getByRole('textbox', { name: /כינוי חדש/i })).toBeInTheDocument()
    expect(screen.getByText('כהן הראשונים')).toBeInTheDocument()
  })

  it('shows active proposal info when one exists', () => {
    const proposal: FamilyAliasProposal = {
      id: 'p1', family_id: 'f1', proposed_by: 'u1',
      proposed_alias: 'כהן השולטים',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      status: 'pending', resolved_at: null, created_at: '',
    }
    render(<AliasProposalDialog {...defaultProps} activeProposal={proposal} />)
    expect(screen.getByText(/כהן השולטים/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('calls propose_alias_change RPC on submit and closes dialog', async () => {
    mockRpc.mockResolvedValueOnce({ error: null })
    render(<AliasProposalDialog {...defaultProps} />)

    fireEvent.change(screen.getByRole('textbox', { name: /כינוי חדש/i }), {
      target: { value: 'כהן המנצחים' },
    })
    fireEvent.click(screen.getByText('הצעת שינוי'))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('propose_alias_change', { p_new_alias: 'כהן המנצחים' })
      expect(defaultProps.onProposed).toHaveBeenCalled()
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('shows Hebrew error when active_proposal_exists is returned', async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: 'active_proposal_exists' } })
    render(<AliasProposalDialog {...defaultProps} />)

    fireEvent.change(screen.getByRole('textbox', { name: /כינוי חדש/i }), {
      target: { value: 'שם כלשהו' },
    })
    fireEvent.click(screen.getByText('הצעת שינוי'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('כבר קיימת הצעה פעילה')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/shared/__tests__/AliasProposalDialog.test.tsx
```

Expected: FAIL — `AliasProposalDialog` module not found.

- [ ] **Step 3: Implement `AliasProposalDialog`**

Create `src/components/shared/AliasProposalDialog.tsx`:

```typescript
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import type { FamilyAliasProposal } from '../../types/database'

interface AliasProposalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentAlias: string | null
  activeProposal: FamilyAliasProposal | null
  onProposed: () => void
}

export default function AliasProposalDialog({
  open,
  onOpenChange,
  currentAlias,
  activeProposal,
  onProposed,
}: AliasProposalDialogProps) {
  const [newAlias, setNewAlias] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!newAlias.trim()) return
    setLoading(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('propose_alias_change', {
      p_new_alias: newAlias.trim(),
    })
    setLoading(false)
    if (rpcError) {
      setError(
        rpcError.message === 'active_proposal_exists'
          ? 'כבר קיימת הצעה פעילה לשינוי הכינוי'
          : rpcError.message
      )
      return
    }
    onProposed()
    onOpenChange(false)
    setNewAlias('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>שינוי כינוי המשפחה</DialogTitle>
        </DialogHeader>

        {activeProposal ? (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">קיימת הצעה פעילה לכינוי:</p>
            <p className="font-medium">"{activeProposal.proposed_alias}"</p>
            <p className="text-xs text-muted-foreground">
              ההצבעה תסתיים ב-{new Date(activeProposal.expires_at).toLocaleTimeString('he-IL')}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {currentAlias && (
              <p className="text-sm text-muted-foreground">
                כינוי נוכחי:{' '}
                <span className="font-medium text-foreground">{currentAlias}</span>
              </p>
            )}
            <Input
              placeholder="כינוי חדש"
              value={newAlias}
              onChange={e => setNewAlias(e.target.value)}
              required
              aria-label="כינוי חדש"
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !newAlias.trim()}
            >
              {loading ? 'שולח...' : 'הצעת שינוי'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/shared/__tests__/AliasProposalDialog.test.tsx
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/AliasProposalDialog.tsx src/components/shared/__tests__/AliasProposalDialog.test.tsx
git commit -m "feat: add AliasProposalDialog component"
```

---

## Task 14: `AliasVoteBanner` component

**Files:**
- Create: `src/components/shared/AliasVoteBanner.tsx`
- Create: `src/components/shared/__tests__/AliasVoteBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/shared/__tests__/AliasVoteBanner.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FamilyAliasProposal, FamilyAliasVote } from '../../../types/database'

const futureDate = new Date(Date.now() + 3_600_000).toISOString()

const proposal: FamilyAliasProposal = {
  id: 'prop1', family_id: 'fam1', proposed_by: 'user2',
  proposed_alias: 'כהן השולטים',
  expires_at: futureDate,
  status: 'pending', resolved_at: null, created_at: '',
}

const yesVote: FamilyAliasVote = {
  id: 'v1', proposal_id: 'prop1', user_id: 'user2',
  vote: true, voted_at: '',
}

const noVote: FamilyAliasVote = {
  id: 'v2', proposal_id: 'prop1', user_id: 'user3',
  vote: false, voted_at: '',
}

const defaultProps = {
  proposal,
  votes: [yesVote],
  totalMembers: 3,
  currentUserId: 'user1',
  castVote: vi.fn(),
}

import AliasVoteBanner from '../AliasVoteBanner'

describe('AliasVoteBanner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows proposed alias and vote tally', () => {
    render(<AliasVoteBanner {...defaultProps} />)
    expect(screen.getByText(/כהן השולטים/)).toBeInTheDocument()
    expect(screen.getByText(/תומכים: 1/)).toBeInTheDocument()
    expect(screen.getByText(/מתנגדים: 0/)).toBeInTheDocument()
    expect(screen.getByText(/לא הצביעו: 2/)).toBeInTheDocument()
  })

  it('shows vote buttons when current user has not voted', () => {
    render(<AliasVoteBanner {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'כן' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'לא' })).toBeInTheDocument()
  })

  it('hides vote buttons and shows result when current user has voted', () => {
    const myVote: FamilyAliasVote = { ...yesVote, id: 'v3', user_id: 'user1' }
    render(<AliasVoteBanner {...defaultProps} votes={[yesVote, myVote]} />)
    expect(screen.queryByRole('button', { name: 'כן' })).not.toBeInTheDocument()
    expect(screen.getByText(/הצבעת: כן/)).toBeInTheDocument()
  })

  it('calls castVote(true) when כן is clicked', async () => {
    defaultProps.castVote.mockResolvedValue(undefined)
    render(<AliasVoteBanner {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'כן' }))
    await waitFor(() => {
      expect(defaultProps.castVote).toHaveBeenCalledWith(true)
    })
  })

  it('calls castVote(false) when לא is clicked', async () => {
    defaultProps.castVote.mockResolvedValue(undefined)
    render(<AliasVoteBanner {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'לא' }))
    await waitFor(() => {
      expect(defaultProps.castVote).toHaveBeenCalledWith(false)
    })
  })

  it('shows error when castVote throws', async () => {
    defaultProps.castVote.mockRejectedValue(new Error('already voted'))
    render(<AliasVoteBanner {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'כן' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('already voted')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/shared/__tests__/AliasVoteBanner.test.tsx
```

Expected: FAIL — `AliasVoteBanner` module not found.

- [ ] **Step 3: Implement `AliasVoteBanner`**

Create `src/components/shared/AliasVoteBanner.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import type { FamilyAliasProposal, FamilyAliasVote } from '../../types/database'

function formatCountdown(expiresAt: string): string {
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (diffMs <= 0) return 'הסתיים'
  const totalSeconds = Math.floor(diffMs / 1000)
  const minutes      = Math.floor(totalSeconds / 60)
  const seconds      = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

interface AliasVoteBannerProps {
  proposal: FamilyAliasProposal
  votes: FamilyAliasVote[]
  totalMembers: number
  currentUserId: string
  castVote: (vote: boolean) => Promise<void>
}

export default function AliasVoteBanner({
  proposal,
  votes,
  totalMembers,
  currentUserId,
  castVote,
}: AliasVoteBannerProps) {
  const [countdown, setCountdown] = useState(() => formatCountdown(proposal.expires_at))
  const [voting, setVoting]       = useState(false)
  const [voteError, setVoteError] = useState<string | null>(null)

  useEffect(() => {
    const interval = setInterval(
      () => setCountdown(formatCountdown(proposal.expires_at)),
      1000
    )
    return () => clearInterval(interval)
  }, [proposal.expires_at])

  const yesVotes = votes.filter(v => v.vote).length
  const noVotes  = votes.filter(v => !v.vote).length
  const notVoted = totalMembers - votes.length
  const myVote   = votes.find(v => v.user_id === currentUserId)

  async function handleVote(vote: boolean) {
    setVoting(true)
    setVoteError(null)
    try {
      await castVote(vote)
    } catch (err) {
      setVoteError((err as Error).message)
    } finally {
      setVoting(false)
    }
  }

  return (
    <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 space-y-2 mb-4">
      <p className="text-sm font-medium">
        הצעה לכינוי חדש:{' '}
        <span className="text-primary">"{proposal.proposed_alias}"</span>
      </p>
      <p className="text-xs text-muted-foreground">
        תומכים: {yesVotes} | מתנגדים: {noVotes} | לא הצביעו: {notVoted}
      </p>
      <p className="text-xs text-muted-foreground">נותרו: {countdown}</p>

      {myVote ? (
        <p className="text-xs text-muted-foreground">הצבעת: {myVote.vote ? 'כן' : 'לא'}</p>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" disabled={voting} onClick={() => handleVote(true)}>כן</Button>
          <Button size="sm" variant="outline" disabled={voting} onClick={() => handleVote(false)}>לא</Button>
        </div>
      )}
      {voteError && <p role="alert" className="text-xs text-destructive">{voteError}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/components/shared/__tests__/AliasVoteBanner.test.tsx
```

Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/AliasVoteBanner.tsx src/components/shared/__tests__/AliasVoteBanner.test.tsx
git commit -m "feat: add AliasVoteBanner component with countdown and vote buttons"
```

---

## Task 15: Wire AliasVoteBanner and alias proposal into layouts and pages

**Files:**
- Modify: `src/components/layout/AdminLayout.tsx`
- Modify: `src/components/layout/PlayerLayout.tsx`
- Modify: `src/pages/admin/players/PlayersPage.tsx`
- Modify: `src/pages/player/profile/ProfilePage.tsx`

- [ ] **Step 1: Add `AliasVoteBanner` to `AdminLayout.tsx`**

Add these imports to `src/components/layout/AdminLayout.tsx`:

```typescript
import { useAliasVote } from '../../hooks/useAliasVote'
import { useFamilyMembers } from '../../hooks/useFamilyMembers'
import AliasVoteBanner from '../shared/AliasVoteBanner'
```

After the existing hook calls, add:
```typescript
const { proposal, votes, castVote } = useAliasVote()
const { members } = useFamilyMembers()
```

In the `<main>` element, add the banner **before** `<Outlet />`:

```typescript
<main className="p-4 max-w-7xl mx-auto">
  {proposal && profile && (
    <AliasVoteBanner
      proposal={proposal}
      votes={votes}
      totalMembers={members.length}
      currentUserId={profile.id}
      castVote={castVote}
    />
  )}
  <Outlet />
</main>
```

- [ ] **Step 2: Add `AliasVoteBanner` to `PlayerLayout.tsx`**

Add these imports to `src/components/layout/PlayerLayout.tsx`:

```typescript
import { useAliasVote } from '../../hooks/useAliasVote'
import { useFamilyMembers } from '../../hooks/useFamilyMembers'
import AliasVoteBanner from '../shared/AliasVoteBanner'
```

After the existing hook calls, add:
```typescript
const { proposal, votes, castVote } = useAliasVote()
const { members } = useFamilyMembers()
```

In the `<main>` element, add the banner **before** `<Outlet />`:

```typescript
<main className="p-4 max-w-4xl mx-auto">
  {proposal && profile && (
    <AliasVoteBanner
      proposal={proposal}
      votes={votes}
      totalMembers={members.length}
      currentUserId={profile.id}
      castVote={castVote}
    />
  )}
  <Outlet />
</main>
```

- [ ] **Step 3: Add "שנה כינוי" button to `PlayersPage.tsx`**

In `src/pages/admin/players/PlayersPage.tsx`, add these imports:

```typescript
import { useAliasVote } from '../../../hooks/useAliasVote'
import AliasProposalDialog from '../../../components/shared/AliasProposalDialog'
```

After the existing hook calls, add:

```typescript
const { proposal: activeProposal } = useAliasVote()
const [aliasOpen, setAliasOpen]    = useState(false)
```

In the family settings card, after the alias display text, add a button:

Find this text in the family settings card:
```typescript
<p className="text-sm text-muted-foreground">
  {family.team_name ?? 'עדיין לא נבחר כינוי'}
</p>
```

Replace it with:
```typescript
<div className="flex items-center gap-2">
  <p className="text-sm text-muted-foreground">
    {family.team_name ?? 'עדיין לא נבחר כינוי'}
  </p>
  <Button variant="ghost" size="sm" onClick={() => setAliasOpen(true)}>
    שנה כינוי
  </Button>
</div>
```

At the end of the JSX (after the `InviteDialog`), add:

```typescript
{family && (
  <AliasProposalDialog
    open={aliasOpen}
    onOpenChange={setAliasOpen}
    currentAlias={family.team_name}
    activeProposal={activeProposal ?? null}
    onProposed={() => setAliasOpen(false)}
  />
)}
```

- [ ] **Step 4: Add "שנה כינוי" button to `ProfilePage.tsx`**

In `src/pages/player/profile/ProfilePage.tsx`, add these imports:

```typescript
import { useAliasVote } from '../../../hooks/useAliasVote'
import AliasProposalDialog from '../../../components/shared/AliasProposalDialog'
```

After the existing hook calls, add:

```typescript
const { proposal: activeProposal } = useAliasVote()
const [aliasOpen, setAliasOpen]    = useState(false)
```

In the family card, after the alias display text:
```typescript
<p className="text-xs text-muted-foreground">
  {family.team_name ?? 'עדיין לא נבחר כינוי'}
</p>
```

Replace it with:
```typescript
<div className="flex items-center gap-1">
  <p className="text-xs text-muted-foreground">
    {family.team_name ?? 'עדיין לא נבחר כינוי'}
  </p>
  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setAliasOpen(true)}>
    שנה
  </Button>
</div>
```

At the end of the ProfilePage JSX (inside the outermost `<div>`), add:

```typescript
{family && (
  <AliasProposalDialog
    open={aliasOpen}
    onOpenChange={setAliasOpen}
    currentAlias={family.team_name}
    activeProposal={activeProposal ?? null}
    onProposed={() => setAliasOpen(false)}
  />
)}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass. Check total test count is greater than before this feature.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/AdminLayout.tsx src/components/layout/PlayerLayout.tsx src/pages/admin/players/PlayersPage.tsx src/pages/player/profile/ProfilePage.tsx
git commit -m "feat: wire AliasVoteBanner and alias proposal dialog into layouts and pages"
```

---

## Final check

- [ ] Run the full test suite one last time:

```bash
npx vitest run
```

Expected: All tests pass with no failures or skipped tests.

- [ ] Verify the build compiles:

```bash
npx tsc --noEmit && npm run build
```

Expected: TypeScript reports no errors, Vite build succeeds.
