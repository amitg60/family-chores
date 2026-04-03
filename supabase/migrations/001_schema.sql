-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role AS ENUM ('admin', 'player');
CREATE TYPE chore_difficulty AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE chore_status AS ENUM ('active', 'pending_approval', 'archived');
CREATE TYPE assignment_status AS ENUM ('pending', 'in_progress', 'completed', 'overdue', 'failed');
CREATE TYPE calendar_slot AS ENUM ('morning', 'noon', 'afternoon');
CREATE TYPE completion_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE reward_type AS ENUM ('store', 'manual_bonus');
CREATE TYPE reward_status AS ENUM ('active', 'pending_approval', 'archived');
CREATE TYPE redemption_status AS ENUM ('pending', 'granted', 'declined');
CREATE TYPE trade_status AS ENUM ('pending', 'accepted', 'declined', 'countered', 'expired');
CREATE TYPE coin_reason AS ENUM ('chore_completed', 'reward_redeemed', 'trade_transfer', 'penalty', 'manual_bonus', 'refund');
CREATE TYPE achievement_trigger AS ENUM ('chore_count', 'coin_total', 'trade_count', 'trust_level', 'weekly_top', 'streak');
CREATE TYPE notification_type AS ENUM (
  'chore_assigned', 'completion_reviewed', 'trade_received', 'trade_resolved',
  'redemption_resolved', 'proposal_resolved', 'penalty_applied', 'achievement_earned', 'reminder'
);
CREATE TYPE feedback_category AS ENUM ('bug', 'improvement', 'love', 'bothers');
CREATE TYPE feedback_mood AS ENUM ('happy', 'neutral', 'frustrated');

-- ============================================================
-- FAMILIES
-- ============================================================
CREATE TABLE families (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id     UUID REFERENCES families(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  avatar_url    TEXT,
  role          user_role NOT NULL DEFAULT 'player',
  trust_level   INTEGER NOT NULL DEFAULT 1 CHECK (trust_level BETWEEN 1 AND 5),
  coin_balance  INTEGER NOT NULL DEFAULT 0 CHECK (coin_balance >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CHORES
-- ============================================================
CREATE TABLE chores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  coin_value          INTEGER NOT NULL DEFAULT 0 CHECK (coin_value >= 0),
  difficulty          chore_difficulty NOT NULL DEFAULT 'easy',
  assigned_to         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_recurring        BOOLEAN NOT NULL DEFAULT FALSE,
  status              chore_status NOT NULL DEFAULT 'active',
  proposed_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  due_date            DATE,
  last_traded_price   INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CHORE ASSIGNMENTS
-- ============================================================
CREATE TABLE chore_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chore_id         UUID NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start       DATE NOT NULL,
  calendar_day     INTEGER CHECK (calendar_day BETWEEN 0 AND 6),
  calendar_slot    calendar_slot,
  reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status           assignment_status NOT NULL DEFAULT 'pending',
  archived         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CHORE COMPLETIONS
-- ============================================================
CREATE TABLE chore_completions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chore_assignment_id   UUID NOT NULL REFERENCES chore_assignments(id) ON DELETE CASCADE,
  completed_by          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  photo_url             TEXT,
  status                completion_status NOT NULL DEFAULT 'pending',
  reviewed_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  rejection_reason      TEXT,
  completed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at           TIMESTAMPTZ
);

-- ============================================================
-- REWARDS
-- ============================================================
CREATE TABLE rewards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  coin_cost    INTEGER NOT NULL DEFAULT 0 CHECK (coin_cost >= 0),
  type         reward_type NOT NULL DEFAULT 'store',
  status       reward_status NOT NULL DEFAULT 'active',
  proposed_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  stock        INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- REWARD REDEMPTIONS
-- ============================================================
CREATE TABLE reward_redemptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id         UUID NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
  redeemed_by       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  coin_cost_at_time INTEGER NOT NULL,
  status            redemption_status NOT NULL DEFAULT 'pending',
  redeemed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);

-- ============================================================
-- TRADE OFFERS
-- ============================================================
CREATE TABLE trade_offers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  offered_by       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  offered_to       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  chore_offered    UUID REFERENCES chore_assignments(id) ON DELETE SET NULL,
  chore_requested  UUID REFERENCES chore_assignments(id) ON DELETE SET NULL,
  coins_offered    INTEGER NOT NULL DEFAULT 0 CHECK (coins_offered >= 0),
  coins_requested  INTEGER NOT NULL DEFAULT 0 CHECK (coins_requested >= 0),
  message          TEXT,
  status           trade_status NOT NULL DEFAULT 'pending',
  counter_offer_id UUID REFERENCES trade_offers(id) ON DELETE SET NULL,
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- COIN TRANSACTIONS
-- ============================================================
CREATE TABLE coin_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  family_id         UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  amount            INTEGER NOT NULL,
  reason            coin_reason NOT NULL,
  related_entity_id UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Archive table (same schema, no RLS — queried by Edge Functions only)
CREATE TABLE coin_transactions_archive (
  id                UUID PRIMARY KEY,
  user_id           UUID NOT NULL,
  family_id         UUID NOT NULL,
  amount            INTEGER NOT NULL,
  reason            coin_reason NOT NULL,
  related_entity_id UUID,
  created_at        TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- ACHIEVEMENTS
-- ============================================================
CREATE TABLE achievements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT UNIQUE NOT NULL,
  title_he      TEXT NOT NULL,
  description_he TEXT NOT NULL,
  icon          TEXT NOT NULL,
  trigger_type  achievement_trigger NOT NULL,
  threshold     INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE player_achievements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, achievement_id)
);

-- ============================================================
-- PENALTIES
-- ============================================================
CREATE TABLE penalties (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chore_assignment_id   UUID NOT NULL REFERENCES chore_assignments(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  coin_deduction        INTEGER NOT NULL CHECK (coin_deduction > 0),
  reason                TEXT NOT NULL,
  waived_by             UUID REFERENCES profiles(id) ON DELETE SET NULL,
  waived_at             TIMESTAMPTZ,
  applied_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE penalty_policy (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id               UUID UNIQUE NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  overdue_day_deduction   INTEGER NOT NULL DEFAULT 5 CHECK (overdue_day_deduction >= 0),
  overdue_week_deduction  INTEGER NOT NULL DEFAULT 15 CHECK (overdue_week_deduction >= 0),
  per_chore_overrides     JSONB NOT NULL DEFAULT '{}',
  updated_by              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  family_id         UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  type              notification_type NOT NULL,
  title_he          TEXT NOT NULL,
  body_he           TEXT NOT NULL,
  related_entity_id UUID,
  read              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- FEEDBACK
-- ============================================================
CREATE TABLE feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  category    feedback_category NOT NULL,
  areas       TEXT[] NOT NULL DEFAULT '{}',
  star_rating INTEGER NOT NULL CHECK (star_rating BETWEEN 1 AND 5),
  mood        feedback_mood NOT NULL,
  free_text   TEXT,
  noted       BOOLEAN NOT NULL DEFAULT FALSE,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SEED: Initial achievements
-- ============================================================
INSERT INTO achievements (key, title_he, description_he, icon, trigger_type, threshold) VALUES
  ('first_chore',      'משימה ראשונה',    'השלמת את המשימה הראשונה שלך!',             '🏆', 'chore_count', 1),
  ('five_chores_week', '5 משימות בשבוע',  'השלמת 5 משימות בשבוע אחד',               '🔥', 'chore_count', 5),
  ('hundred_coins',    '100 מטבעות',      'צברת 100 מטבעות',                         '💰', 'coin_total',  100),
  ('first_trade',      'עסקה ראשונה',     'ביצעת עסקת חליפין ראשונה',                '🤝', 'trade_count', 1),
  ('trust_upgrade',    'שדרוג אמון',      'עלית ברמת האמון',                         '⭐', 'trust_level', 2),
  ('weekly_top',       'מוביל השבוע',     'היית המרוויח הגדול ביותר השבוע',          '👑', 'weekly_top',  1),
  ('perfect_week',     'שבוע מושלם',      'השלמת כל המשימות החובה בזמן שבוע שלם',   '🗓️', 'streak',      1);
