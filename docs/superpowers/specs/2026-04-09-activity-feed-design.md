# Activity Feed — Design Spec

**Date:** 2026-04-09
**Status:** Approved for implementation planning

---

## Goal

Add real-time updates to the existing family activity feed on the Player Dashboard, so that when any family member earns an achievement it appears live in all currently online players' feeds.

---

## Scope

- **In scope:** Real-time subscription on `player_achievements` INSERT events → refetch feed
- **Out of scope:** Chore completions in the feed (future), trades in the feed (future), admin dashboard feed (not needed)

---

## Current State

`useActivityFeed.ts` already exists and:
- Queries `player_achievements` joined with `achievements` and `profiles`, ordered by `earned_at DESC`, limited to 20
- Returns `ActivityItem[]` with `id`, `profileName`, `profileAvatar`, `achievementIcon`, `achievementTitle`, `earnedAt`
- Fetches once on mount; no real-time updates
- Has 3 passing tests in `useActivityFeed.test.ts`

`PlayerDashboard.tsx` already renders the feed as a horizontal scrollable pill strip. No changes needed there.

---

## Architecture

### `useActivityFeed.ts` changes only

Add a Supabase Realtime channel subscription alongside the existing fetch logic:

1. Accept `familyId: string | null` as a parameter (passed from `useAuth().profile?.family_id`)
2. On mount (when `familyId` is available), subscribe to channel `activity-feed-{familyId}` on table `player_achievements` for `INSERT` events
3. On any INSERT event, call `fetchFeed()` to refresh the full list
4. Unsubscribe and remove the channel on unmount

Channel naming includes `familyId` to prevent the duplicate-channel crash seen elsewhere in the codebase.

### `PlayerDashboard.tsx` — one-line change

Pass `profile?.family_id ?? null` to `useActivityFeed(familyId)`.

---

## File Changes

| File | Change |
|---|---|
| `src/hooks/useActivityFeed.ts` | Add `familyId` param, realtime subscription, unsubscribe on unmount |
| `src/pages/player/PlayerDashboard.tsx` | Pass `profile?.family_id ?? null` to `useActivityFeed` |
| `src/hooks/__tests__/useActivityFeed.test.ts` | Add test: realtime INSERT triggers refetch |

---

## Realtime Channel Details

```
channel name : activity-feed-{familyId}
table        : player_achievements
event        : INSERT
filter       : none (RLS on the SELECT query handles family isolation)
on INSERT    : call fetchFeed()
```

No filter is needed on the subscription itself because `fetchFeed()` queries with RLS applied — only the current family's data is ever returned.

---

## Error Handling

- If `familyId` is null, skip subscription setup entirely (user not yet in a family)
- Realtime errors are logged to console but do not affect the fetch-based fallback
- If the channel fails to connect, the feed still shows data from the initial fetch

---

## Testing

New test in `useActivityFeed.test.ts`:
- Mock the Supabase channel API (`mockChannel`, `mockOn`, `mockSubscribe`)
- Render the hook with a `familyId`
- Simulate an INSERT event callback
- Assert `fetchFeed` was called a second time (i.e., `mockFrom` called twice)
