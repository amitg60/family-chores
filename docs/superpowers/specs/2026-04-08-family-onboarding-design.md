# Family Onboarding & Invitations — Design Spec

**Date:** 2026-04-08
**Status:** Approved

---

## Overview

Two related flows that solve the same root problem: new users have no `family_id`, so they are invisible to each other under RLS.

1. **Admin self-service signup** — A new admin (parent) can create their family and account without manual Supabase intervention.
2. **Player/co-admin invite** — An existing admin generates a unique, time-limited invite link (with QR code) to bring family members into the family.

Multi-family isolation is already enforced by existing RLS policies (`family_id = get_my_family_id()`). These flows ensure every user gets a `family_id` assigned at registration time.

---

## Scope

- Players and co-admins join via invite link (not by self-registering freely)
- One invite link per intended person — single-use, expires in 5 hours
- Admin can invite both players (children) and co-admins (parents)
- Admin self-service signup creates a new isolated family
- Family has an optional fun team alias (e.g., "כהן השולטים") for identity
- Any family member (admin or player) can upload or replace the family profile picture
- No changes to existing RLS policies — they already correctly enforce family isolation

---

## TODO: Secure Authentication

The current authentication model uses email + password only. Future iterations should evaluate:

- **Password reset flow** — users currently have no way to recover a forgotten password via the app UI
- **Multi-factor authentication (MFA)** — Supabase Auth supports TOTP; consider requiring it for admin accounts
- **Magic links / OTP via email** — passwordless login option, simpler for children
- **OAuth providers** — Google sign-in for ease of use on family devices
- **Session management** — configurable session expiry, forced sign-out from all devices

None of these are in scope for this spec. They should be designed as a dedicated "Authentication Hardening" feature.

---

## 1. Database Layer

### Migration: `013_family_onboarding.sql`

#### 1.1 Extend `families` table

```sql
ALTER TABLE families ADD COLUMN team_name  TEXT NULL;
ALTER TABLE families ADD COLUMN avatar_url TEXT NULL;
```

The `team_name` is an optional fun alias (e.g., "כהן השולטים") shown alongside the family name on the join page and in the admin dashboard.

**Ownership rules for `team_name`:**
- Set by the founding admin at family creation time (signup form) — this is a direct write, no vote needed.
- **After creation, no one can edit it directly.** Any family member (admin or player) who wants to change it must go through the alias voting mechanism (Section 7).
- All family members see the alias as read-only with a **"שנה כינוי"** button that opens the voting dialog.
- On the join page (`/join`), the alias is displayed as read-only context. Joiners cannot set or change it.

The `avatar_url` is the public URL of the family profile picture stored in the `family-avatars` Supabase Storage bucket.

#### 1.2 New table: `family_invites`

```sql
CREATE TABLE family_invites (
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
```

A token is **valid** when: `expires_at > now() AND used_at IS NULL`.

RLS policies:
- Admins can INSERT invites for their own family
- Admins can SELECT invites for their own family
- Admins can DELETE (cancel) invites for their own family
- No player access
- No unauthenticated access (token validation is via a SECURITY DEFINER RPC)

#### 1.3 RPC: `generate_invite_token(p_role user_role)` → `text`

Called by an authenticated admin. Inserts a row into `family_invites` with:
- `token = encode(gen_random_bytes(16), 'hex')` (32-char hex)
- `family_id = get_my_family_id()`
- `created_by = auth.uid()`
- `role = p_role`
- `expires_at = now() + interval '5 hours'`

Returns the token string. SECURITY DEFINER.

#### 1.4 RPC: `validate_invite_token(p_token text)` → `json`

**No auth required** (called before signup). Returns:

```json
{ "valid": true,  "family_name": "משפחת כהן", "team_name": "כהן השולטים", "invited_by": "אמיר" }
{ "valid": false, "reason": "expired" }   -- token found but expired
{ "valid": false, "reason": "used" }      -- token already redeemed
{ "valid": false, "reason": "not_found" } -- token does not exist
```

SECURITY DEFINER. Safe to expose publicly — returns no sensitive data beyond the family's display name and inviter's first name.

#### 1.5 RPC: `redeem_invite(p_token text, p_name text, p_user_id uuid)` → `void`

Called immediately after `supabase.auth.signUp()` succeeds. Steps (all in one transaction):
1. Fetch the invite row — error if not found, expired, or already used
2. INSERT into `profiles`: `id = p_user_id`, `family_id` from invite, `role` from invite, `name = p_name`
3. UPDATE `family_invites SET used_at = now(), used_by = p_user_id`

SECURITY DEFINER. Errors propagate to the client as PostgreSQL exceptions.

#### 1.6 RPC: `create_family_and_admin(p_family_name text, p_team_name text, p_admin_name text)` → `void`

Called immediately after `supabase.auth.signUp()` succeeds for a new admin. Steps (all in one transaction):
1. INSERT into `families`: `name = p_family_name`, `team_name = p_team_name` (nullable) → get new `family_id`
2. INSERT into `profiles`: `id = auth.uid()`, `family_id`, `name = p_admin_name`, `role = 'admin'`

SECURITY DEFINER. `p_team_name` may be empty string — store as NULL if blank.

---

## 2. Admin — Invite Generation UI

**File modified:** `src/pages/admin/players/PlayersPage.tsx`

### Invite Button

A **"הזמן בן משפחה"** button at the top of the PlayersPage. Clicking opens an invite dialog.

### Invite Dialog (`InviteDialog` component)

`src/components/admin/InviteDialog.tsx` — receives `familyId` as prop.

**Step 1 — Role selection:**
Two options displayed as cards or radio buttons:
- "שחקן (ילד)" → `role = 'player'`
- "מנהל משותף (הורה)" → `role = 'admin'`

A **"צור קישור"** button calls `generate_invite_token(p_role)` RPC.

**Step 2 — Link display (after RPC succeeds):**
- The full invite URL: `https://<APP_URL>/join?token=<token>`
- **Copy to clipboard** button (`aria-label="העתק קישור"`)
- **QR code** — rendered client-side via `qrcode.react` library, encoding the same URL
- Expiry note: `"הקישור תקף ל-5 שעות"`
- **"צור קישור חדש"** button — resets to Step 1

`APP_URL` is read from `import.meta.env.VITE_APP_URL` (must be set in Vercel environment variables).

### Pending Invites List

Below the players table, a section titled **"הזמנות פעילות"** lists all unused, non-expired invites:

| תאריך יצירה | תפקיד | פעולה |
|---|---|---|
| היום 14:30 | שחקן | [בטל] |

The **"בטל"** button deletes the invite row. Invites that have expired are filtered out client-side.

Invites are fetched via a `useInvites` hook that queries `family_invites` where `used_at IS NULL` and `expires_at > now()`.

---

## 3. Join Flow (`/join`)

**New file:** `src/pages/JoinPage.tsx`
**Router change:** Add `{ path: '/join', element: <JoinPage /> }` as a public route outside `ProtectedRoute`

### On Load

1. Read `token` from `new URLSearchParams(window.location.search).get('token')`
2. Call `validate_invite_token(p_token)` RPC
3. **If invalid/expired/used:** Show error card — `"הקישור אינו תקף או שפג תוקפו — בקש מהמנהל קישור חדש"`. No form.
4. **If valid:** Show welcome card:
   - `"הוזמת על ידי [invited_by] למשפחת [family_name] — [team_name]"`
   - Signup form below

### Signup Form

Fields:
- שם מלא (`name`)
- אימייל (`email`)
- סיסמה (`password`)
- כפתור: **"הצטרף"**

### On Submit

1. `supabase.auth.signUp({ email, password })`  — if error, show Hebrew error message
2. `redeem_invite(p_token, p_name, p_user_id)` RPC — if error (race: token expired/used between validation and submit), show `"הקישור כבר נוצל או שפג תוקפו"`
3. On success: `RootRedirect` handles routing — admin role → `/admin`, player role → `/player`

---

## 4. Admin Self-Service Signup (`/signup`)

**New file:** `src/pages/SignupPage.tsx`
**Router change:** Add `{ path: '/signup', element: <SignupPage /> }` as a public route outside `ProtectedRoute`

### Form Fields

- שם המשפחה (e.g., "משפחת כהן") — required
- כינוי המשפחה (e.g., "כהן השולטים") — optional
- השם שלך — required
- אימייל — required
- סיסמה — required
- כפתור: **"צור משפחה"**

### On Submit

1. `supabase.auth.signUp({ email, password })` — if error, show Hebrew error message
2. `create_family_and_admin(p_family_name, p_team_name, p_admin_name)` RPC
3. On success: redirect to `/admin`

---

## 5. LoginPage Update

**File modified:** `src/pages/LoginPage.tsx`

Add a small link below the submit button:

```
משפחה חדשה? <Link to="/signup">צור חשבון</Link>
```

---

## 6. Family Profile Picture

### Storage

A new Supabase Storage bucket `family-avatars` with the following properties:
- **Public bucket** — uploaded images are accessible via a plain public URL (no signed URLs needed; family avatars are not sensitive)
- File path pattern: `{family_id}/avatar.jpg` — overwriting the same path replaces the previous photo
- RLS on storage: any authenticated user whose `get_my_family_id() = family_id` can upload and read

### Upload Flow

Any family member (admin or player) can upload the family picture from:
- **Admin:** a "הגדרות משפחה" section within `PlayersPage` showing:
  - Family name (read-only display)
  - Team alias — read-only display with a **"שנה כינוי"** button (opens `AliasProposalDialog`). Shows `"עדיין לא נבחר כינוי"` if not yet set.
  - Family avatar upload (`FamilyAvatarUpload` component)
- **Player:** their `ProfilePage` (already exists at `/player/profile`) — add a "תמונת המשפחה" card showing the current avatar (editable) and the family name + alias (read-only)

Both use the same `FamilyAvatarUpload` component.

**`src/components/shared/FamilyAvatarUpload.tsx`** (shared between admin and player):
- Displays current family avatar (or a placeholder icon if none set)
- File input with `accept="image/jpeg,image/png,image/webp"` — no other file types accepted
- On file select, **client-side validation before any upload:**
  - Allowed types: `image/jpeg`, `image/png`, `image/webp` only. Show error `"סוג קובץ לא נתמך — יש להעלות תמונה בפורמט JPG, PNG או WebP"` and abort if rejected.
  - Maximum file size: **5 MB** before compression. Show error `"הקובץ גדול מדי — הגודל המרבי הוא 5MB"` and abort if exceeded.
- On validation pass:
  1. Compress + strip EXIF client-side via `browser-image-compression` (max output size 500 KB, same pattern as completion photos)
  2. Upload to `family-avatars/{family_id}/avatar.jpg` via `supabase.storage.from('family-avatars').upload(..., { upsert: true })`
  3. Get the public URL via `supabase.storage.from('family-avatars').getPublicUrl(...)`
  4. UPDATE `families SET avatar_url = <public_url>` where `id = family_id`
- Shows upload progress and success/error state

**Storage bucket size limit (server-side enforcement):** Configure the `family-avatars` bucket in Supabase with a maximum file size of **1 MB** (post-compression). This acts as a second line of defence if the client-side compression step fails. The bucket is configured via the migration using `storage.buckets` upsert with `file_size_limit = 1048576` and `allowed_mime_types = ['image/jpeg', 'image/png', 'image/webp']`.

### Display

The family avatar is shown in the header of both layouts:
- **`AdminLayout`:** small circular avatar next to the family name in the top-left
- **`PlayerLayout`:** small circular avatar next to the family name (family name is not currently shown — add it alongside the avatar)

Both layouts fetch the family row on mount via a lightweight `useFamily` hook:

**`src/hooks/useFamily.ts`**
```typescript
// Returns { family: Family | null, loading: boolean }
// Queries: supabase.from('families').select('*').eq('id', profile.family_id).single()
```

The `Family` type already exists in `src/types/database.ts` as `{ id, name, created_at }` — add `team_name` and `avatar_url` fields.

### File additions for this section

| File | Action |
|---|---|
| `supabase/migrations/013_family_onboarding.sql` | bucket creation + storage RLS (added to existing migration) |
| `src/hooks/useFamily.ts` | New |
| `src/components/shared/FamilyAvatarUpload.tsx` | New |
| `src/components/layout/AdminLayout.tsx` | Modified (show family avatar + name) |
| `src/components/layout/PlayerLayout.tsx` | Modified (show family avatar + name) |
| `src/pages/admin/players/PlayersPage.tsx` | Modified (add FamilyAvatarUpload) |
| `src/pages/player/profile/ProfilePage.tsx` | Modified (add FamilyAvatarUpload) |

---

## 7. Family Alias Voting

Any family member (admin or player) can propose a new alias. The change only takes effect if an absolute majority of family members vote yes within 1 hour.

### Voting Rules

- **Proposer auto-votes yes** when they submit the proposal.
- **Majority = yes_votes > total_family_members ÷ 2** (absolute majority). Abstentions effectively count as no.
- **1-hour voting window** — after expiry, votes are counted and the outcome is applied.
- **Early acceptance**: if yes votes exceed the majority threshold before 1 hour, the alias is accepted immediately.
- **Early rejection**: if the remaining uncast votes can no longer flip the result to yes, rejected immediately.
- **Tie or no majority** after 1 hour → alias rejected, current alias unchanged.
- **One active proposal per family at a time** — the propose button is disabled while a vote is pending.

### DB additions (added to `013_family_onboarding.sql`)

#### New notification types

```sql
ALTER TYPE notification_type ADD VALUE 'alias_vote_requested';
ALTER TYPE notification_type ADD VALUE 'alias_vote_resolved';
```

#### New table: `family_alias_proposals`

```sql
CREATE TABLE family_alias_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  proposed_by     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  proposed_alias  TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,  -- created_at + 1 hour
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'rejected')),
  resolved_at     TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### New table: `family_alias_votes`

```sql
CREATE TABLE family_alias_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  UUID NOT NULL REFERENCES family_alias_proposals(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  vote         BOOLEAN NOT NULL,  -- true = yes, false = no
  voted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_id, user_id)
);
```

RLS:
- Family members can SELECT proposals and votes for their own family.
- Family members can INSERT their own vote (one per proposal, enforced by UNIQUE constraint).
- No UPDATE or DELETE on votes — votes are immutable once cast.

#### RPC: `propose_alias_change(p_new_alias text)` → `void`

SECURITY DEFINER. Steps:
1. Check no `pending` proposal exists for `get_my_family_id()` — error `'active_proposal_exists'` if one does.
2. INSERT into `family_alias_proposals` with `expires_at = now() + interval '1 hour'`.
3. Auto-cast proposer's yes vote: INSERT into `family_alias_votes` with `vote = true`.
4. Call `check_alias_vote_outcome(proposal_id)` to handle the edge case of a 1-member family (immediate resolution).
5. INSERT `alias_vote_requested` notifications for all other family members.

#### RPC: `cast_alias_vote(p_proposal_id uuid, p_vote boolean)` → `void`

SECURITY DEFINER. Steps:
1. Fetch proposal — error if not found, not `pending`, or `expires_at < now()`.
2. INSERT into `family_alias_votes` — DB UNIQUE constraint prevents double-voting.
3. Call `check_alias_vote_outcome(p_proposal_id)` to evaluate early resolution.

#### RPC: `check_alias_vote_outcome(p_proposal_id uuid)` → `void`

SECURITY DEFINER. Called internally by `propose_alias_change`, `cast_alias_vote`, and `resolve_alias_proposal`. Logic:

```
total_members  = COUNT of profiles WHERE family_id = proposal.family_id
yes_votes      = COUNT of votes WHERE vote = true
no_votes       = COUNT of votes WHERE vote = false
majority_threshold = total_members / 2  (integer division, e.g. 4→2, 3→1, 2→1)

IF yes_votes > majority_threshold:
  → status = 'accepted': UPDATE families SET team_name = proposed_alias
  → send 'alias_vote_resolved' notifications to all family members (result: accepted)
ELSE IF no_votes >= total_members - yes_votes  (remaining votes can't flip result):
  → status = 'rejected'
  → send 'alias_vote_resolved' notifications to all family members (result: rejected)
-- else: outcome still undecided, do nothing
```

Also UPDATE `family_alias_proposals SET status, resolved_at = now()` when resolved.

#### RPC: `resolve_alias_proposal(p_proposal_id uuid)` → `void`

SECURITY DEFINER. Called by the client when the 1-hour timer expires (via a `useEffect` countdown in the voting UI). Checks `expires_at < now()`, then calls `check_alias_vote_outcome`. Idempotent — safe to call multiple times.

### UI: Proposing a new alias

The team alias field in both **`PlayersPage`** (admins) and **`ProfilePage`** (players) gains a **"שנה כינוי"** button next to the current alias display.

Clicking it opens **`AliasProposalDialog`** (`src/components/shared/AliasProposalDialog.tsx`):
- Shows current alias
- Input for proposed new alias
- Submit button: **"הצעת שינוי"**
- If a vote is already pending: shows the active proposal and its current vote count instead of the input
- Calls `propose_alias_change(p_new_alias)` RPC on submit

### UI: Voting banner

A **`AliasVoteBanner`** component (`src/components/shared/AliasVoteBanner.tsx`) is shown persistently at the top of the main content area in both `AdminLayout` and `PlayerLayout` when there is an active pending proposal for the family.

Banner content:
- `"הצעה לכינוי חדש: [proposed_alias] — מוצע על ידי [proposer_name]"`
- Current vote tally: `"תומכים: X | מתנגדים: Y | לא הצביעו: Z"`
- Countdown timer: `"נותרו X:XX דקות"`
- **כן** and **לא** vote buttons — disabled after the member has already voted
- If the current user is the proposer, show their auto-yes vote as already cast

**`useAliasVote` hook** (`src/hooks/useAliasVote.ts`):
- Fetches the active pending proposal for `profile.family_id`
- Subscribes to realtime changes on `family_alias_proposals` and `family_alias_votes` filtered to the family
- Provides `{ proposal, votes, castVote, resolveIfExpired, loading }`
- When `expires_at` passes (checked via `setInterval`), calls `resolve_alias_proposal` RPC

Both layouts mount `<AliasVoteBanner>` — it renders nothing when there is no pending proposal.

### File additions for this section

| File | Action |
|---|---|
| `src/hooks/useAliasVote.ts` | New |
| `src/components/shared/AliasProposalDialog.tsx` | New |
| `src/components/shared/AliasVoteBanner.tsx` | New |
| `src/components/layout/AdminLayout.tsx` | Modified (mount AliasVoteBanner) |
| `src/components/layout/PlayerLayout.tsx` | Modified (mount AliasVoteBanner) |
| `src/pages/admin/players/PlayersPage.tsx` | Modified (add "שנה כינוי" button) |
| `src/pages/player/profile/ProfilePage.tsx` | Modified (add "שנה כינוי" button) |

---

## 8. File Summary

| File | Action |
|---|---|
| `supabase/migrations/013_family_onboarding.sql` | New |
| `src/pages/SignupPage.tsx` | New |
| `src/pages/JoinPage.tsx` | New |
| `src/components/admin/InviteDialog.tsx` | New |
| `src/components/shared/FamilyAvatarUpload.tsx` | New |
| `src/components/shared/AliasProposalDialog.tsx` | New |
| `src/components/shared/AliasVoteBanner.tsx` | New |
| `src/hooks/useInvites.ts` | New |
| `src/hooks/useFamily.ts` | New |
| `src/hooks/useAliasVote.ts` | New |
| `src/pages/admin/players/PlayersPage.tsx` | Modified (invite button + pending list + family avatar + alias proposal) |
| `src/pages/player/profile/ProfilePage.tsx` | Modified (family avatar upload + alias proposal) |
| `src/components/layout/AdminLayout.tsx` | Modified (family avatar + name + AliasVoteBanner) |
| `src/components/layout/PlayerLayout.tsx` | Modified (family avatar + name + AliasVoteBanner) |
| `src/pages/LoginPage.tsx` | Modified (add signup link) |
| `src/router.tsx` | Modified (add /join and /signup routes) |
| `src/types/database.ts` | Modified (add team_name, avatar_url to Family type) |

---

## 9. Out of Scope

- Password reset / forgot password flow
- Email verification (Supabase sends a confirmation email by default — can be disabled in Supabase dashboard for now)
- Voting on changes to family name (only alias/team name is votable)
- Removing a family member from the family
- Transferring admin role to another member
