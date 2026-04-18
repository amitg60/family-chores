export type UserRole = 'admin' | 'player'
export type ChoreStatus = 'active' | 'pending_approval' | 'archived' | 'deleted'
export type ChoreDifficulty = 'easy' | 'medium' | 'hard'
export type AssignmentStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'failed'
export type CalendarSlot = 'morning' | 'noon' | 'afternoon'
export type CompletionStatus = 'pending' | 'approved' | 'rejected'
export type RewardType = 'store' | 'manual_bonus'
export type RewardStatus = 'active' | 'pending_approval' | 'archived'
export type RedemptionStatus = 'pending' | 'granted' | 'declined'
export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'countered' | 'expired'
export type RecurrenceType = 'none' | 'weekly' | 'daily' | 'monthly'
export type CoinReason = 'chore_completed' | 'reward_redeemed' | 'trade_transfer' | 'penalty' | 'manual_bonus' | 'refund'
export type AchievementTrigger = 'chore_count' | 'coin_total' | 'trade_count' | 'trust_level' | 'weekly_top' | 'streak'
export type NotificationType =
  | 'chore_assigned' | 'completion_reviewed' | 'trade_received' | 'trade_resolved'
  | 'redemption_resolved' | 'proposal_resolved' | 'penalty_applied' | 'achievement_earned'
  | 'reminder' | 'alias_vote_requested' | 'alias_vote_resolved' | 'chore_deleted'
export type FeedbackCategory = 'bug' | 'improvement' | 'love' | 'bothers'
export type FeedbackMood = 'happy' | 'neutral' | 'frustrated'

export interface Family {
  id: string
  name: string
  team_name: string | null
  avatar_url: string | null
  created_at: string
}

export interface Profile {
  id: string
  family_id: string | null
  name: string
  avatar_url: string | null
  role: UserRole
  trust_level: number
  coin_balance: number
  created_at: string
  updated_at: string
}

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
  due_date: string | null
  last_traded_price: number | null
  created_at: string
  updated_at: string
}

export interface ChoreAssignment {
  id: string
  chore_id: string
  user_id: string
  week_start: string
  calendar_day: number | null
  calendar_slot: CalendarSlot | null
  reminder_enabled: boolean
  status: AssignmentStatus
  archived: boolean
  created_at: string
  updated_at: string
  hasRejection?: boolean
}

export interface ChoreCompletion {
  id: string
  chore_assignment_id: string
  completed_by: string
  photo_url: string | null
  status: CompletionStatus
  reviewed_by: string | null
  rejection_reason: string | null
  completed_at: string
  reviewed_at: string | null
}

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
  stock: number | null
  created_at: string
  updated_at: string
}

export interface RewardRedemption {
  id: string
  reward_id: string
  redeemed_by: string
  coin_cost_at_time: number
  status: RedemptionStatus
  redeemed_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export interface TradeOffer {
  id: string
  family_id: string
  offered_by: string
  offered_to: string | null
  chore_offered: string | null
  chore_requested: string | null
  coins_offered: number
  coins_requested: number
  message: string | null
  status: TradeStatus
  counter_offer_id: string | null
  expires_at: string
  created_at: string
}

export interface CoinTransaction {
  id: string
  user_id: string
  family_id: string
  amount: number
  reason: CoinReason
  related_entity_id: string | null
  created_at: string
}

export interface Achievement {
  id: string
  key: string
  title_he: string
  description_he: string
  icon: string
  trigger_type: AchievementTrigger
  threshold: number
  created_at: string
}

export interface PlayerAchievement {
  id: string
  user_id: string
  achievement_id: string
  earned_at: string
}

export interface Penalty {
  id: string
  chore_assignment_id: string
  user_id: string
  coin_deduction: number
  reason: string
  waived_by: string | null
  waived_at: string | null
  applied_at: string
}

export interface PenaltyPolicy {
  id: string
  family_id: string
  overdue_day_deduction: number
  overdue_week_deduction: number
  per_chore_overrides: Record<string, { day_deduction: number; week_deduction: number }>
  updated_by: string | null
  updated_at: string
}

export interface Notification {
  id: string
  user_id: string
  family_id: string
  type: NotificationType
  title_he: string
  body_he: string
  related_entity_id: string | null
  read: boolean
  created_at: string
}

export interface Feedback {
  id: string
  user_id: string
  family_id: string
  category: FeedbackCategory
  areas: string[]
  star_rating: number
  mood: FeedbackMood
  free_text: string | null
  noted: boolean
  resolved: boolean
  created_at: string
}

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

export interface ChoreSchedule {
  id: string
  chore_id: string
  day_of_week: number | null  // null = weekly/monthly, 0–6 (0=Sun) = daily
  assigned_to: string
}
