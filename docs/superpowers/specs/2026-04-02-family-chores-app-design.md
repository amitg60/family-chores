# Family Chores App — Design Spec
**Date:** 2026-04-02
**Status:** Approved for implementation planning

---

## Overview

A Hebrew-language, gamified web application for families to manage household chores. Admins (parents) create and manage chores and rewards. Players (children and parents) pick up chores, complete them, earn virtual coins, and redeem coins for real-life rewards. The app features a barter market, a shared weekly calendar, achievements, and a feedback system. Accessible on phone, tablet, and desktop.

---

## 1. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite) + Tailwind CSS + shadcn/ui |
| Backend / Auth / DB | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| Hosting | Vercel (free tier, deploy from Git) |
| Language | Hebrew (RTL throughout, `dir="rtl"` on root) |

**Rationale:** Supabase eliminates the need for a custom backend server — auth, file storage (photo proofs), real-time subscriptions, and the database are all managed via the Supabase JS client. shadcn/ui provides polished, accessible components. Tailwind supports RTL natively. Vercel deploys in one click.

---

## 2. User Roles

### Admin (Parent)
- Create, edit, archive chores and rewards
- Assign chores to specific players or leave open to the pool
- Approve or reject chore completion submissions (with photo proof)
- Approve or reject kid-proposed chores and rewards
- Manage reward store (coin costs, stock levels)
- Grant manual bonus rewards to any player
- Promote/demote player trust levels
- Waive penalties manually
- View family activity dashboard and feedback statistics

### Player (Child or Parent)
- View personal dashboard with mandatory and picked-up chores
- Pick up chores from the open pool
- Pin chores to a time slot on the shared weekly calendar
- Submit photo proof of completion
- Propose new chores and rewards (subject to admin approval)
- Browse reward store and redeem coins
- Post and respond to chore trade/barter offers
- Toggle reminders for chores with pinned time slots
- Submit app feedback
- Earn achievements

---

## 3. Data Model

### Users
- `id`, `email`, `name`, `avatar_url`
- `role`: `admin` | `player`
- `trust_level`: 1–5 (controls verification requirement; new players start at 1)
- `coin_balance`: integer (denormalized cache — always updated atomically in the same transaction as a Coin Transaction record; source of truth is the Coin Transactions table)
- `family_id`: references Families table

### Families
- `id`, `name`

### Chores
- `id`, `family_id`, `title`, `description`
- `coin_value`: integer
- `difficulty`: `easy` | `medium` | `hard` (set by admin)
- `assigned_to`: nullable user ID (null = open pool)
- `is_recurring`: boolean (auto-populates each week)
- `status`: `active` | `pending_approval` | `archived`
- `proposed_by`: nullable user ID (for kid-submitted chores)
- `approved_by`: nullable admin user ID
- `due_date`: nullable date
- `last_traded_price`: nullable integer (updated after each completed trade)

### Chore Assignments
- `id`, `chore_id`, `user_id`
- `week_start`: date (ISO week start — supports recurring weekly resets)
- `calendar_day`: nullable (0=Sun … 6=Sat)
- `calendar_slot`: nullable `morning` | `noon` | `afternoon`
- `reminder_enabled`: boolean
- `status`: `pending` | `in_progress` | `completed` | `overdue` | `failed`

### Chore Completions
- `id`, `chore_assignment_id`, `completed_by`
- `photo_url`: Supabase Storage URL
- `status`: `pending` | `approved` | `rejected`
- `reviewed_by`: nullable admin user ID
- `rejection_reason`: nullable text
- `completed_at`, `reviewed_at`

### Rewards
- `id`, `family_id`, `title`, `description`
- `coin_cost`: integer
- `type`: `store` | `manual_bonus`
- `status`: `active` | `pending_approval` | `archived`
- `proposed_by`: nullable user ID
- `approved_by`: nullable admin user ID
- `stock`: nullable integer (null = unlimited)

### Reward Redemptions
- `id`, `reward_id`, `redeemed_by`
- `coin_cost_at_time`: integer (snapshot at redemption)
- `status`: `pending` | `granted` | `declined`
- `redeemed_at`, `resolved_at`

### Trade Offers
- `id`, `family_id`
- `offered_by`: user ID
- `offered_to`: nullable user ID (null = open offer to all)
- `chore_offered`: nullable chore assignment ID (chore offerer is giving away)
- `chore_requested`: nullable chore assignment ID (chore offerer wants to receive)
- `coins_offered`: integer (≥ 0, coins offerer pays)
- `coins_requested`: integer (≥ 0, coins offerer asks for)
- `message`: nullable text
- `status`: `pending` | `accepted` | `declined` | `countered` | `expired`
- `counter_offer_id`: nullable (self-referential, for counter-offers)
- `expires_at`: timestamp
- `created_at`

### Coin Transactions
- `id`, `user_id`, `family_id`
- `amount`: integer (positive = earned, negative = spent/penalty)
- `reason`: `chore_completed` | `reward_redeemed` | `trade_transfer` | `penalty` | `manual_bonus` | `refund`
- `related_entity_id`: nullable (chore completion ID, trade ID, etc.)
- `created_at`

### Achievements
- `id`, `key` (unique slug), `title_he` (Hebrew), `description_he`, `icon`
- `trigger_type`: `chore_count` | `coin_total` | `trade_count` | `trust_level` | `weekly_top` | `streak` | etc.
- `threshold`: integer

### Player Achievements
- `id`, `user_id`, `achievement_id`, `earned_at`

### Penalties
- `id`, `chore_assignment_id`, `user_id`
- `coin_deduction`: integer
- `reason`: text
- `waived_by`: nullable admin user ID
- `waived_at`: nullable timestamp
- `applied_at`

### Penalty Policy
- `id`, `family_id`
- `overdue_day_deduction`: integer (coins deducted when overdue by end of day)
- `overdue_week_deduction`: integer (coins deducted when overdue by end of week)
- `per_chore_overrides`: JSONB (map of chore_id → `{day_deduction, week_deduction}` for per-chore overrides)
- `updated_by`: admin user ID
- `updated_at`

### Notifications
- `id`, `user_id`, `family_id`
- `type`: `chore_assigned` | `completion_reviewed` | `trade_received` | `trade_resolved` | `redemption_resolved` | `proposal_resolved` | `penalty_applied` | `achievement_earned` | `reminder`
- `title_he`, `body_he`: Hebrew notification text
- `related_entity_id`: nullable
- `read`: boolean (default false)
- `created_at`

### Feedback
- `id`, `user_id`, `family_id`
- `category`: `bug` | `improvement` | `love` | `bothers`
- `areas`: array of `chores` | `store` | `barter` | `calendar` | `achievements` | `general`
- `star_rating`: 1–5
- `mood`: `happy` | `neutral` | `frustrated`
- `free_text`: nullable text
- `created_at`

---

## 4. Core Features

### 4.1 Chore Management
- Admins create chores with title, description, coin value, difficulty, optional assignee, optional due date, and recurring flag.
- Recurring chores auto-populate each week as new Chore Assignments.
- Open-pool chores are visible to all players; players can pick them up (creates a Chore Assignment for that player).
- Kid-proposed chores enter `pending_approval` status and appear in the admin approval queue.

### 4.2 Chore Completion & Trust Verification
- Players mark a chore done by submitting a photo. Creates a Chore Completion record with status `pending`.
- **Trust levels 1–3:** Admin must review and approve/reject. Coins are awarded on approval.
- **Trust levels 4–5:** Self-verification — completion is auto-approved and coins awarded immediately.
- Admins promote trust levels manually with an optional milestone note.
- Rejected completions notify the player with the rejection reason.

### 4.3 Reward Store & Manual Bonuses
- Admins create rewards with coin costs and optional stock limits.
- Players browse and redeem rewards; creates a Reward Redemption with status `pending` for admin to grant or decline.
- Admins can grant manual bonus rewards (type `manual_bonus`) to any player at any time.
- Kid-proposed rewards enter `pending_approval` and appear in the admin queue.

### 4.4 Chore Barter Market
- Any player can post a trade offer on a chore they hold (mandatory or picked up).
- An offer can include any combination of: a chore to give away, a chore to receive, coins to pay, coins to ask for. Pure coin-for-chore and chore-for-chore trades are both valid.
- Offers can be targeted (to a named player) or open (visible to all).
- Recipients can accept, decline, or counter-offer (a counter creates a linked Trade Offer record).
- On acceptance: chore assignments are transferred, coin transfers are recorded as Coin Transactions. Both players are notified.
- Each completed trade updates `last_traded_price` on the chore, providing a natural "market price" visible on the chore detail screen.
- Admins can view all active trades and intervene if needed.
- Offers expire after a configurable duration (default 48 hours).

### 4.5 Weekly Calendar
- Shared family calendar visible to all players and admins.
- Week runs Sunday–Saturday (Israeli standard).
- Each day is divided into 3 time slots: 🌅 בוקר–צהריים / ☀️ צהריים–אחה"צ / 🌆 אחה"צ–ערב.
- Players pin their chore assignments to a day + time slot. Each card shows player avatar, chore title, and status.
- Color-coded per player for at-a-glance readability.
- Players can only manage their own pins; everyone can view the full family calendar.

### 4.6 Reminders
- Players toggle a reminder on any chore assignment.
- If a time slot is pinned, the reminder fires 30 minutes before that slot.
- If no slot is pinned, the reminder fires at a default time (configurable, default: 09:00 on due date).
- Delivered as in-app notifications (push notification support to be added in a future version).

### 4.7 Penalties
- Admins configure a global penalty policy (and optionally override per chore):
  - Overdue by end of day: deduct X coins.
  - Overdue by end of week: deduct Y coins + mark assignment `failed`.
- Penalties are recorded as negative Coin Transactions with reason `penalty`.
- Players receive an in-app notification when a penalty is applied.
- Admins can waive any penalty manually.
- Repeated failures are visible in the admin dashboard and may inform trust level decisions.

### 4.8 Achievements & Announcements
- Achievements are evaluated automatically when relevant events occur (chore completed, coins earned, trade completed, etc.).
- Initial achievement set:
  - 🏆 משימה ראשונה (First chore completed)
  - 🔥 5 משימות בשבוע (5 chores in one week)
  - 💰 100 מטבעות (Earned 100 coins total)
  - 🤝 עסקה ראשונה (First successful trade)
  - ⭐ שדרוג אמון (Trust level upgraded)
  - 👑 מוביל השבוע (Top earner this week)
  - 🗓️ שבוע מושלם (All mandatory chores completed on time for a full week)
- When earned, a toast-style pop-up appears for all currently online family members.
- An Activity Feed on the dashboard shows recent completions, achievements, and trade events — making the app feel alive.

### 4.9 Feedback System
- A "משוב" button is accessible from the main menu for all players.
- Each feedback submission captures:
  - **Category** (single select): Bug / Improvement idea / Something I love / Something that bothers me
  - **App area** (multi-select): Chores, Store, Barter Market, Calendar, Achievements, General
  - **Star rating** (1–5): Overall satisfaction right now
  - **Mood** (single emoji tap): 😊 Happy / 😐 Neutral / 😤 Frustrated
  - **Free text** (optional): open-ended, no character limit
- Admin feedback dashboard shows:
  - Average star rating trend (by week)
  - Mood distribution % per week
  - Category breakdown (pie chart)
  - Area heatmap (most-mentioned parts of the app)
  - All free-text submissions, filterable by category / area / player / date, with "noted" / "resolved" status markers

---

## 5. UI Design

**Overall feel:** Clean, modern, gamified. Mobile-first responsive layout (phone, tablet, desktop). RTL Hebrew throughout. Dark-friendly color scheme with vibrant accents for coins, achievements, and status badges.

### Key Screens

**Login** — Email/password form, family app name and logo at top.

**Player Dashboard**
- Top bar: avatar, name, coin balance (coin icon), notification bell
- Activity feed strip: scrollable horizontal ticker of recent achievements and completions
- "המשימות שלי" section: mandatory chores first (highlighted if overdue), then picked-up open chores
- Action buttons: בחר משימה (Pick a Chore) | החנות (Store) | שוק החלפות (Barter Market) | לוח שנה (Calendar)

**Admin Dashboard**
- Summary cards: pending approvals, total coins awarded this week, active trades, pending proposals
- Quick actions: Add Chore, Add Reward, Review Pending
- Family leaderboard: players ranked by coins this week

**Chore Pool** — Chore cards showing title, coin value, difficulty badge, last traded price. Tap to pick up or post a trade offer.

**Chore Completion** — Player taps "סיימתי", camera/file picker opens for photo, submits. Card shows "ממתין לאישור" until reviewed.

**Weekly Calendar** — Full week grid (Sun–Sat × 3 slots). Each cell shows pinned chore cards with player avatar + status. Players tap a chore to pin/unpin.

**Barter Market** — Active offer cards showing: what's offered, what's asked, who posted it, time remaining. Players accept, counter-offer, or post new offers.

**Reward Store** — Grid of reward cards with coin cost and stock. "מימוש" (Redeem) button with confirmation step. Kid-proposed rewards shown with pending badge.

**Profile / Trust Level** — Player's coin history, achievements earned, trust level progress, trade history.

**Feedback Screen** — Category, area tags, star rating, mood emoji, free text. Submit button.

**Admin Feedback Dashboard** — Charts, heatmap, filterable free-text list.

---

## 6. Notifications (In-App)

All notifications delivered in-app via Supabase Realtime. Future version: push notifications.

| Event | Recipient |
|---|---|
| Chore assigned | Assigned player |
| Completion approved / rejected | Player who submitted |
| Trade offer received | Target player (or all, if open) |
| Trade accepted / declined / countered | Offer originator |
| Reward redemption granted / declined | Redeeming player |
| Chore / reward proposal approved / rejected | Proposing player |
| Penalty applied | Affected player |
| Achievement earned | Earner (+ toast to all online) |
| Reminder (time-based) | Player with reminder enabled |

---

## 7. Security, Privacy & Storage Management

### 7.1 Photo Security & Privacy

**EXIF stripping:**
All photos are processed client-side before upload using the browser Canvas API (via `browser-image-compression`). The re-encoded JPEG/WebP output strips all EXIF metadata — including GPS location, device model, and timestamp — before the file ever leaves the device.

**Private storage bucket:**
Photos are stored in a **private** Supabase Storage bucket (`completion-photos`). There are no public URLs. Access is granted only via short-lived signed URLs (expiry: 1 hour), generated server-side only when an admin or the submitting player requests to view a specific photo.

**Row Level Security (RLS):**
RLS policies are enabled on every Supabase table. Key rules:
- Users can only read/write rows belonging to their own `family_id`
- Players can only update their own records (e.g., their own chore assignments)
- Only admins can approve completions, modify trust levels, or apply penalties
- Coin Transactions and Penalty records are read-only for players (insert only via server-side logic / Supabase Edge Functions)
- Feedback is write-only for players (they cannot read other players' feedback)

**No sensitive data in logs:**
Photo URLs, user emails, and avatar URLs are never logged to Supabase logs or Vercel function logs.

---

### 7.2 Storage & Database Size Management

**Target:** Stay within Supabase free tier at all times.
- Database: 500 MB
- File storage: 1 GB
- Bandwidth: 5 GB/month

**Photo compression (client-side, before upload):**
- Max resolution: 1280 × 960 px
- Format: WebP (smaller than JPEG at equivalent quality)
- Quality: 75%
- Estimated size per photo: ~100–200 KB
- At 5 chores/week × 4 family members × 52 weeks: ~200 photos/year ≈ ~30–40 MB/year of photos. Well within the 1 GB storage limit.

**Photo retention policy:**
Photos are ephemeral proof — they have no long-term value once reviewed.
- On approval or rejection of a Chore Completion: the photo file is deleted from Supabase Storage immediately after the admin reviews it.
- The `photo_url` field is set to `null` after deletion. The Completion record itself is kept for audit history.
- Unreviewed photos (pending) older than 30 days are auto-deleted by a weekly cleanup job (Supabase Edge Function on a cron schedule) and the completion is marked `expired`.

**Database row pruning:**
- **Coin Transactions:** Rows older than 12 months are archived to a `coin_transactions_archive` table (same schema, no RLS overhead). Balance integrity is maintained via the denormalized `coin_balance` on Users.
- **Chore Completions:** Rejected completions older than 90 days are hard-deleted (photo already gone). Approved completions older than 12 months are hard-deleted.
- **Trade Offers:** Expired and declined offers older than 90 days are hard-deleted.
- **Feedback:** Rows marked `resolved` older than 6 months are hard-deleted.
- **Notifications:** Read notifications older than 30 days are hard-deleted.
- All pruning runs as a weekly Supabase Edge Function (cron). Admins can trigger it manually from the admin dashboard.

**Chore Assignment cleanup:**
- Old Chore Assignments (completed or failed) from more than 8 weeks ago are soft-deleted (flagged `archived = true`) and excluded from all queries by default. Hard-deleted after 12 months.

**Storage monitoring:**
- Admin dashboard shows current Supabase storage usage (DB size + file storage) fetched from the Supabase Management API.
- A warning banner appears in the admin dashboard if DB exceeds 400 MB or file storage exceeds 800 MB, prompting a manual pruning run.

---

## 8. Out of Scope (Future Versions)

- Push notifications (browser / mobile)
- Multi-family support (single family per deployment for now)
- Mobile native app (React Native)
- Automated trust level promotion (rule-based, currently manual)
- Chore photo gallery / history view
- Email notifications
- Dark mode toggle (uses system preference for now)

---

## 9. Success Criteria

- Any family member can log in from phone, tablet, or computer in Hebrew
- Admins can manage the full chore and reward lifecycle without technical knowledge
- Players can complete the full loop (pick chore → submit photo → earn coins → redeem reward) without admin help beyond approval
- Barter market correctly transfers chore ownership and coins atomically
- Calendar shows the full family week at a glance
- Achievements announce to all online players in real time
- Feedback submissions are captured and visible to admins with aggregated statistics
