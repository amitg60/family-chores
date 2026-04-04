import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../hooks/useChoreAssignments', () => ({
  useChoreAssignments: vi.fn(() => ({ assignments: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', name: 'דנה', coin_balance: 50, trust_level: 2 } }),
}))

import { useChoreAssignments } from '../../../hooks/useChoreAssignments'
import { useChores } from '../../../hooks/useChores'
import PlayerDashboard from '../PlayerDashboard'

const mockUseChoreAssignments = vi.mocked(useChoreAssignments)
const mockUseChores = vi.mocked(useChores)

const fakeChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', coin_value: 10,
  difficulty: 'easy' as const, assigned_to: null, is_recurring: false,
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
})
