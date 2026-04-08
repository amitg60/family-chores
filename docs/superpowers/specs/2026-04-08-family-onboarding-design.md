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
- **Admin:** a "תמונת המשפחה" section within `PlayersPage` (alongside family name and team name display)
- **Player:** their `ProfilePage` (already exists at `/player/profile`) — add a "תמונת המשפחה" card

Both use the same `FamilyAvatarUpload` component.

**`src/components/shared/FamilyAvatarUpload.tsx`** (shared between admin and player):
- Displays current family avatar (or a placeholder icon if none set)
- File input (image only) with a camera/edit icon overlay
- On file select:
  1. Compress + strip EXIF client-side via `browser-image-compression` (same pattern as completion photos)
  2. Upload to `family-avatars/{family_id}/avatar.jpg` via `supabase.storage.from('family-avatars').upload(..., { upsert: true })`
  3. Get the public URL via `supabase.storage.from('family-avatars').getPublicUrl(...)`
  4. UPDATE `families SET avatar_url = <public_url>` where `id = family_id`
- Shows upload progress and success/error state

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

## 7. File Summary

| File | Action |
|---|---|
| `supabase/migrations/013_family_onboarding.sql` | New |
| `src/pages/SignupPage.tsx` | New |
| `src/pages/JoinPage.tsx` | New |
| `src/components/admin/InviteDialog.tsx` | New |
| `src/components/shared/FamilyAvatarUpload.tsx` | New |
| `src/hooks/useInvites.ts` | New |
| `src/hooks/useFamily.ts` | New |
| `src/pages/admin/players/PlayersPage.tsx` | Modified (invite button + pending list + family avatar) |
| `src/pages/player/profile/ProfilePage.tsx` | Modified (add family avatar upload) |
| `src/components/layout/AdminLayout.tsx` | Modified (show family avatar + name) |
| `src/components/layout/PlayerLayout.tsx` | Modified (show family avatar + name) |
| `src/pages/LoginPage.tsx` | Modified (add signup link) |
| `src/router.tsx` | Modified (add /join and /signup routes) |
| `src/types/database.ts` | Modified (add team_name, avatar_url to Family type) |

---

## 7. Out of Scope

- Password reset / forgot password flow
- Email verification (Supabase sends a confirmation email by default — can be disabled in Supabase dashboard for now)
- Admin editing family name or team name after creation (can be added to admin settings later)
- Removing a family member from the family
- Transferring admin role to another member
