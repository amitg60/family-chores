import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../hooks/useChoreAssignments', () => ({
  useChoreAssignments: vi.fn(() => ({ assignments: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', name: 'דנה', coin_balance: 50, trust_level: 2, family_id: 'f1' } }),
}))
vi.mock('../../../hooks/useAchievements', () => ({
  useAchievements: vi.fn(() => ({
    achievements: [], earnedIds: new Set(), totalCompletedAllTime: 0,
    loading: false, error: null, refetch: vi.fn(),
  })),
}))
vi.mock('../../../hooks/useActivityFeed', () => ({
  useActivityFeed: vi.fn(() => ({ items: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../hooks/useWeeklyPopulation', () => ({
  useWeeklyPopulation: vi.fn(),
}))
vi.mock('../../../hooks/usePenalties', () => ({
  usePenalties: vi.fn(() => ({ penalties: [], loading: false, error: null })),
}))
vi.mock('../../../lib/checkAchievements', () => ({
  checkAndAwardAchievements: vi.fn().mockResolvedValue([]),
}))

import { useChoreAssignments } from '../../../hooks/useChoreAssignments'
import { useChores } from '../../../hooks/useChores'
import { useAchievements } from '../../../hooks/useAchievements'
import { useActivityFeed } from '../../../hooks/useActivityFeed'
import { checkAndAwardAchievements } from '../../../lib/checkAchievements'
import { usePenalties } from '../../../hooks/usePenalties'
import PlayerDashboard from '../PlayerDashboard'

const mockUseChoreAssignments = vi.mocked(useChoreAssignments)
const mockUseChores = vi.mocked(useChores)
const mockUseAchievements = vi.mocked(useAchievements)
const mockUseActivityFeed = vi.mocked(useActivityFeed)
const mockCheckAndAward = vi.mocked(checkAndAwardAchievements)
const mockUsePenalties = vi.mocked(usePenalties)

const fakeChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', coin_value: 10,
  difficulty: 'easy' as const, assigned_to: null, recurrence_type: 'none' as const,
  status: 'active' as const, description: null, proposed_by: null,
  approved_by: null, due_date: null, last_traded_price: null,
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

const fakeAssignment = {
  id: 'a1', chore_id: 'c1', user_id: 'p1', week_start: '2026-04-05',
  calendar_day: null, calendar_slot: null, reminder_enabled: false,
  status: 'pending' as const, archived: false,
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

function renderDashboard() {
  return render(<MemoryRouter><PlayerDashboard /></MemoryRouter>)
}

describe('PlayerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUseAchievements.mockReturnValue({
      achievements: [], earnedIds: new Set(), totalCompletedAllTime: 0,
      loading: false, error: null, refetch: vi.fn(),
    })
    mockUseActivityFeed.mockReturnValue({ items: [], loading: false, error: null, refetch: vi.fn() })
    mockCheckAndAward.mockResolvedValue([])
    mockUsePenalties.mockReturnValue({ penalties: [], loading: false, error: null })
  })

  it('shows loading spinner while loading', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: true, error: null, refetch: vi.fn() })
    renderDashboard()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no assignments', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    expect(screen.getByText(/אין משימות השבוע/)).toBeInTheDocument()
  })

  it('shows assignment with chore title and coin value', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [fakeAssignment], loading: false, error: null, refetch: vi.fn() })
    mockUseChores.mockReturnValue({ chores: [fakeChore], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
    expect(screen.getByText(/10 מטבעות/)).toBeInTheDocument()
  })

  it('shows "סיימתי" link for pending assignment', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [fakeAssignment], loading: false, error: null, refetch: vi.fn() })
    mockUseChores.mockReturnValue({ chores: [fakeChore], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    const link = screen.getByRole('link', { name: 'סיימתי' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/player/chores/a1/complete')
  })

  it('shows "בחר משימה" link to the chore pool', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    expect(screen.getByRole('link', { name: 'בחר משימה' })).toBeInTheDocument()
  })

  it('shows activity feed item when present', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
    mockUseActivityFeed.mockReturnValue({
      items: [{
        id: 'pa1',
        profileName: 'דנה',
        profileAvatar: null,
        achievementIcon: '🏆',
        achievementTitle: 'משימה ראשונה',
        earnedAt: '2026-04-05T10:00:00Z',
      }],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
    renderDashboard()
    expect(screen.getByText('🏆')).toBeInTheDocument()
    expect(screen.getByText('דנה')).toBeInTheDocument()
  })

  it('calls checkAndAwardAchievements when all data loaded', async () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    await waitFor(() => expect(mockCheckAndAward).toHaveBeenCalled())
  })

  it('shows count badge when same recurring chore has multiple assignments', () => {
    const a2 = { ...fakeAssignment, id: 'a2' }
    mockUseChoreAssignments.mockReturnValue({
      assignments: [fakeAssignment, a2], loading: false, error: null, refetch: vi.fn(),
    })
    mockUseChores.mockReturnValue({ chores: [fakeChore], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    expect(screen.getByText('2 משימות')).toBeInTheDocument()
    // grouped → only one card for the chore
    expect(screen.getAllByText('כלי מטבח')).toHaveLength(1)
  })

  it('does not show count badge for a single assignment', () => {
    mockUseChoreAssignments.mockReturnValue({
      assignments: [fakeAssignment], loading: false, error: null, refetch: vi.fn(),
    })
    mockUseChores.mockReturnValue({ chores: [fakeChore], loading: false, error: null, refetch: vi.fn() })
    renderDashboard()
    expect(screen.queryByText(/^\d+ משימות$/)).not.toBeInTheDocument()
  })

  it('does not render penalty section when no penalties', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePenalties.mockReturnValue({ penalties: [], loading: false, error: null })
    renderDashboard()
    expect(screen.queryByText('היסטוריית הפסדים')).not.toBeInTheDocument()
  })

  it('renders penalty history section when penalties exist', () => {
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
    mockUsePenalties.mockReturnValue({
      penalties: [{
        id: 'pen1',
        chore_assignment_id: 'a1',
        user_id: 'p1',
        coin_deduction: 1,
        reason: 'overdue',
        waived_by: null,
        waived_at: null,
        applied_at: '2026-04-19T23:59:00Z',
        batch_id: null,
        chore_assignments: { chore_id: 'c1', chores: { title: 'כלי מטבח' } },
      }],
      loading: false,
      error: null,
    })
    renderDashboard()
    expect(screen.getByText('היסטוריית הפסדים')).toBeInTheDocument()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
  })
})
