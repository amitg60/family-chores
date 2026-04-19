import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../hooks/useChoreAssignments', () => ({
  useChoreAssignments: vi.fn(() => ({ assignments: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', family_id: 'f1' } }),
}))

const mockFunctions = vi.fn()
vi.mock('../../../../lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockFunctions(...args) } },
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

const nonRecurringChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', coin_value: 10,
  difficulty: 'easy' as const, assigned_to: null, recurrence_type: 'none' as const,
  status: 'active' as const, is_pool_visible: true,
  description: null, proposed_by: null, approved_by: null,
  due_date: null, last_traded_price: null,
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

const recurringChore = {
  ...nonRecurringChore,
  id: 'c2', title: 'להאכיל חיות', recurrence_type: 'daily' as const,
  is_pool_visible: true,
}

const existingAssignment = {
  id: 'a1', chore_id: 'c2', user_id: 'p1', week_start: '2026-04-13',
  calendar_day: null, calendar_slot: null, reminder_enabled: false,
  status: 'pending' as const, archived: false, assigned_by: 'p1',
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

  it('shows empty state when no visible chores', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('אין משימות זמינות כרגע.')).toBeInTheDocument()
  })

  it('shows pool chore with assign button', () => {
    mockUseChores.mockReturnValue({ chores: [nonRecurringChore], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /בחר כלי מטבח/ })).toBeInTheDocument()
  })

  it('hides non-recurring chore when is_pool_visible is false', () => {
    const hidden = { ...nonRecurringChore, is_pool_visible: false }
    mockUseChores.mockReturnValue({ chores: [hidden], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.queryByText('כלי מטבח')).not.toBeInTheDocument()
  })

  it('shows recurring chore even when player already has an assignment for it', () => {
    mockUseChores.mockReturnValue({ chores: [recurringChore], loading: false, error: null, refetch: vi.fn() })
    mockUseChoreAssignments.mockReturnValue({ assignments: [existingAssignment], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('להאכיל חיות')).toBeInTheDocument()
  })

  it('calls self-assign-chore Edge Function on button click and navigates for non-recurring', async () => {
    mockUseChores.mockReturnValue({ chores: [nonRecurringChore], loading: false, error: null, refetch: vi.fn() })
    mockFunctions.mockResolvedValue({ data: { ok: true }, error: null })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: /בחר כלי מטבח/ }))
    await waitFor(() => {
      expect(mockFunctions).toHaveBeenCalledWith('self-assign-chore', expect.objectContaining({
        body: expect.objectContaining({ chore_id: 'c1', calendar_day: null, calendar_slot: null }),
      }))
      expect(mockNavigate).toHaveBeenCalledWith('/player')
    })
  })

  it('stays on pool page after self-assigning recurring chore', async () => {
    mockUseChores.mockReturnValue({ chores: [recurringChore], loading: false, error: null, refetch: vi.fn() })
    mockFunctions.mockResolvedValue({ data: { ok: true }, error: null })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: /בחר להאכיל חיות/ }))
    await waitFor(() => expect(mockFunctions).toHaveBeenCalled())
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows Hebrew error message when Edge Function returns error', async () => {
    mockUseChores.mockReturnValue({ chores: [nonRecurringChore], loading: false, error: null, refetch: vi.fn() })
    mockFunctions.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'CHORE_TAKEN' }) } } })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: /בחר כלי מטבח/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('המשימה כבר נלקחה על ידי שחקן אחר'))
  })
})
