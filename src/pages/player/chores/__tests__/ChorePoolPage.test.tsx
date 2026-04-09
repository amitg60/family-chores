import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

vi.mock('../../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../hooks/useChoreAssignments', () => ({
  useChoreAssignments: vi.fn(() => ({ assignments: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', family_id: 'f1' } }),
}))
vi.mock('../../../../lib/weekStart', () => ({
  getCurrentWeekStart: vi.fn(() => '2026-04-05'),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import { useChores } from '../../../../hooks/useChores'
import { useChoreAssignments } from '../../../../hooks/useChoreAssignments'
import ChorePoolPage from '../ChorePoolPage'

const mockUseChores = vi.mocked(useChores)
const mockUseChoreAssignments = vi.mocked(useChoreAssignments)

const openChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', coin_value: 10,
  difficulty: 'easy' as const, assigned_to: null, recurrence_type: 'none' as const,
  status: 'active' as const, description: null, proposed_by: null,
  approved_by: null, due_date: null, last_traded_price: null,
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

function renderPoolPage() {
  return render(<MemoryRouter><ChorePoolPage /></MemoryRouter>)
}

describe('ChorePoolPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseChoreAssignments.mockReturnValue({ assignments: [], loading: false, error: null, refetch: vi.fn() })
  })

  it('shows loading spinner while loading', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: true, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no open chores', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('אין משימות זמינות כרגע.')).toBeInTheDocument()
  })

  it('shows open chore with title, coin value, and difficulty', () => {
    mockUseChores.mockReturnValue({ chores: [openChore], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
    expect(screen.getByText(/10 מטבעות/)).toBeInTheDocument()
    expect(screen.getByText('קל')).toBeInTheDocument()
  })

  it('hides chores the player already picked up this week', () => {
    const existingAssignment = {
      id: 'a1', chore_id: 'c1', user_id: 'p1', week_start: '2026-04-05',
      calendar_day: null, calendar_slot: null, reminder_enabled: false,
      status: 'pending' as const, archived: false,
      created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
    }
    mockUseChores.mockReturnValue({ chores: [openChore], loading: false, error: null, refetch: vi.fn() })
    mockUseChoreAssignments.mockReturnValue({ assignments: [existingAssignment], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.queryByText('כלי מטבח')).not.toBeInTheDocument()
  })

  it('picks up chore on click and navigates to /player', async () => {
    mockUseChores.mockReturnValue({ chores: [openChore], loading: false, error: null, refetch: vi.fn() })
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: 'קח משימה' }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/player'))
  })

  it('shows error when pick up fails', async () => {
    mockUseChores.mockReturnValue({ chores: [openChore], loading: false, error: null, refetch: vi.fn() })
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: 'fail' } }) })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: 'קח משימה' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בבחירת המשימה'))
  })
})
