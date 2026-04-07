# Profile Screen — Design Spec
**Date:** 2026-04-07
**Status:** Approved for implementation planning

---

## Overview

A personal profile screen for players showing their identity, trust level, coin transaction history, and achievements. Accessible from the player layout header (avatar tap) and desktop nav. Scoped to viewing one's own profile only — other players' profiles are out of scope for this iteration.

---

## 1. Layout

### Header (fixed above tabs)
Always visible regardless of active tab:
- **Avatar** — large circle using shadcn/ui `Avatar` with `AvatarImage` and `AvatarFallback` (first letter of name)
- **Name** — bold, centered
- **Coin balance** — 🪙 icon + balance number
- **Trust level bar** — label "רמת אמון" + shadcn/ui `Progress` component at `(trust_level / 5) * 100%`, with numeric label "X / 5"

### Tab Bar (below header)
Three full-width tabs, local `useState` — no URL routing per tab:

| Tab | Icon | Label |
|---|---|---|
| 0 (default) | 💰 | מטבעות |
| 1 | 🏆 | הישגים |
| 2 | 🤝 | מסחר |

Active tab: `bg-primary text-primary-foreground`. Inactive: `hover:bg-muted`. Tab bar is fixed; only tab content scrolls.

---

## 2. Tab Content

### Tab 0: מטבעות (Coins)

**Summary row** — 2-column grid of stat cards:
- **סה"כ הרוויח** — sum of all positive `amount` values
- **סה"כ הוציא** — sum of absolute values of all negative `amount` values

**Transaction list** — last 20 transactions, each row:
- Amount: green (`text-green-600`) for positive, red (`text-destructive`) for negative, prefixed with `+` / `−`
- Reason: Hebrew label (see mapping below)
- Date: formatted with `toLocaleDateString('he-IL')`

If no transactions: `<p>אין עדיין עסקאות.</p>`

**Reason → Hebrew label mapping:**
| `reason` | Hebrew |
|---|---|
| `chore_completed` | משימה הושלמה |
| `reward_redeemed` | פדיון פרס |
| `trade_transfer` | העברת מסחר |
| `penalty` | קנס |
| `manual_bonus` | בונוס |
| `refund` | החזר |

---

### Tab 1: הישגים (Achievements)

A summary card containing:
- **Count** — "X מתוך 7 הישגים" (using `earnedIds.size` from `useAchievements`)
- **Earned icons row** — earned achievement icons (emoji only, no text), displayed horizontally, wrapping if needed
- **CTA button** — "ראה את כל ההישגים" → navigates to `/player/achievements`

Data from `useAchievements(profile?.id)` — already implemented, no new data fetching.

If no achievements earned: show "טרם הושגו הישגים." with the CTA button still visible.

---

### Tab 2: מסחר (Trades) — Placeholder

A single locked placeholder card:
- Icon: 🤝 (large)
- Title: **שוק ההחלפות**
- Body: **"תכונה זו תהיה זמינה בקרוב"**
- Visual treatment: `opacity-50`, with `<span aria-hidden="true">🔒</span>` lock indicator
- No data fetching

---

## 3. Data & Hooks

### `useCoinTransactions(userId: string | undefined)`

**File:** `src/hooks/useCoinTransactions.ts`

Follows the established hook pattern: `mountedRef` + `useCallback` + two `useEffect`s.

**Queries (run in parallel via `Promise.all`):**
```typescript
// Recent transactions for display
supabase
  .from('coin_transactions')
  .select('*')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .limit(20)

// All transactions for accurate totals
supabase
  .from('coin_transactions')
  .select('amount')
  .eq('user_id', userId)
```

**Returns:**
```typescript
interface UseCoinTransactionsResult {
  transactions: CoinTransaction[]
  totalEarned: number   // sum of positive amounts
  totalSpent: number    // sum of absolute values of negative amounts
  loading: boolean
  error: string | null
}
```

`totalEarned` and `totalSpent` are computed from **all** transactions for the user (no `.limit()` on the aggregate query). The display list is a separate `.limit(20)` query. Both run in parallel via `Promise.all`.

Early return (loading: false, empty results) when `userId` is undefined, consistent with `useAchievements`.

---

## 4. Routing & Navigation

### Route
Add to `/player` children in `src/router.tsx`:
```typescript
{ path: 'profile', element: <ProfilePage /> }
```

### Navigation entry points
1. **PlayerLayout header** — wrap the avatar + name block in a `<Link to="/player/profile">` so tapping the avatar navigates to the profile (mobile-primary entry point)
2. **Desktop nav** — add a "פרופיל" `NavLink` to `/player/profile` in the `<nav>` block, after "הישגים", using the same className pattern as existing nav links

---

## 5. File Structure

| File | Action |
|---|---|
| `src/hooks/useCoinTransactions.ts` | Create |
| `src/hooks/__tests__/useCoinTransactions.test.ts` | Create |
| `src/pages/player/profile/ProfilePage.tsx` | Create |
| `src/pages/player/profile/__tests__/ProfilePage.test.tsx` | Create |
| `src/router.tsx` | Modify — add profile route |
| `src/components/layout/PlayerLayout.tsx` | Modify — avatar link + nav link |

---

## 6. Testing

### `useCoinTransactions` (4 tests)
1. Starts in loading state
2. Returns transactions with correct `totalEarned` and `totalSpent`
3. Sets error on failed fetch
4. Returns empty results when `userId` is undefined

### `ProfilePage` (6 tests)
1. Shows loading state
2. Shows error state
3. Shows player name, coin balance, and trust level bar
4. Shows coin summary stats and transaction list (coins tab)
5. Shows achievements summary with count and CTA (achievements tab)
6. Shows locked trade placeholder (trades tab)

---

## 7. shadcn/ui Components

- `Progress` — for trust level bar. If not yet installed in the project, use a plain `div`-based bar: `<div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: \`${(trust_level / 5) * 100}%\` }} /></div>`
- `Card`, `CardContent`, `CardHeader`, `CardTitle` — already installed
- `Button`, `Badge`, `Avatar` — already installed
