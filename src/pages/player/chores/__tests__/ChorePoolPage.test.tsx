import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFunctionsInvoke, mockFrom, mockRpc } from '../../../../test/mocks/supabase'

vi.mock('../../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../hooks/useChoreAssignments', () => ({
  useChoreAssignments: vi.fn(() => ({ assignments: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', family_id: 'f1' } }),
}))
vi.mock('../../../../hooks/useMyProposals', () => ({
  useMyProposals: vi.fn(() => ({ proposals: [], refetch: vi.fn() })),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import { useChores } from '../../../../hooks/useChores'
import { useChoreAssignments } from '../../../../hooks/useChoreAssignments'
import { useMyProposals } from '../../../../hooks/useMyProposals'
import ChorePoolPage from '../ChorePoolPage'
import type { Chore } from '../../../../types/database'

const mockUseChores = vi.mocked(useChores)
const mockUseChoreAssignments = vi.mocked(useChoreAssignments)
const mockUseMyProposals = vi.mocked(useMyProposals)

const nonRecurringChore: Chore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', coin_value: 10,
  difficulty: 'easy' as const, assigned_to: null, recurrence_type: 'none' as const,
  status: 'active' as const, is_pool_visible: true,
  description: null, proposed_by: null, approved_by: null,
  proposal_rejection_reason: null,
  due_date: null, last_traded_price: null,
  created_at: '2026-04-05T00:00:00Z', updated_at: '2026-04-05T00:00:00Z',
}

const recurringChore: Chore = {
  ...nonRecurringChore,
  id: 'c2', title: 'להאכיל חיות', recurrence_type: 'daily' as const,
}

const pendingChoreProposal: Chore = {
  ...nonRecurringChore,
  id: 'p1',
  title: 'לנקות את החצר',
  status: 'pending_approval',
  proposed_by: 'p1',
  is_pool_visible: false,
}

const rejectedChoreProposal: Chore = {
  ...pendingChoreProposal,
  id: 'p2',
  title: 'לשטוף כלים',
  status: 'archived',
  proposal_rejection_reason: 'כבר יש משימה דומה',
}

const rejectedNoReason: Chore = {
  ...rejectedChoreProposal,
  id: 'p3',
  title: 'לקפל כביסה',
  proposal_rejection_reason: null,
}

const existingAssignment = {
  id: 'a1', chore_id: 'c2', user_id: 'p1', week_start: '2026-04-13',
  calendar_day: null, calendar_slot: null, reminder_enabled: false, reminder_sent_at: null,
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
    mockUseMyProposals.mockReturnValue({ proposals: [], refetch: vi.fn() })
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
    mockFunctionsInvoke.mockResolvedValue({ data: { ok: true }, error: null })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: /בחר כלי מטבח/ }))
    await waitFor(() => {
      expect(mockFunctionsInvoke).toHaveBeenCalledWith('self-assign-chore', expect.objectContaining({
        body: expect.objectContaining({ chore_id: 'c1', calendar_day: null, calendar_slot: null }),
      }))
      expect(mockNavigate).toHaveBeenCalledWith('/player')
    })
  })

  it('stays on pool page after self-assigning recurring chore', async () => {
    mockUseChores.mockReturnValue({ chores: [recurringChore], loading: false, error: null, refetch: vi.fn() })
    mockFunctionsInvoke.mockResolvedValue({ data: { ok: true }, error: null })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: /בחר להאכיל חיות/ }))
    await waitFor(() => expect(mockFunctionsInvoke).toHaveBeenCalled())
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows Hebrew error message when Edge Function returns error', async () => {
    mockUseChores.mockReturnValue({ chores: [nonRecurringChore], loading: false, error: null, refetch: vi.fn() })
    mockFunctionsInvoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'CHORE_TAKEN' }) } } })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: /בחר כלי מטבח/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('המשימה כבר נלקחה על ידי שחקן אחר'))
  })

  it('shows "הצע משימה" button', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByRole('button', { name: 'הצע משימה' })).toBeInTheDocument()
  })

  it('"הצע משימה" button opens proposal dialog', async () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: 'הצע משימה' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'הצע משימה חדשה' })).toBeInTheDocument()
  })

  it('proposal form submit with valid data calls supabase insert', async () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ insert: mockInsert })

    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: 'הצע משימה' }))
    await userEvent.type(screen.getByLabelText('כותרת'), 'לנקות חלונות')
    await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
    await userEvent.type(screen.getByLabelText('ערך במטבעות'), '15')
    await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('chores')
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        title: 'לנקות חלונות',
        coin_value: 15,
        status: 'pending_approval',
        proposed_by: 'p1',
        family_id: 'f1',
      }))
    })
  })

  it('proposal form submit success closes dialog', async () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })

    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: 'הצע משימה' }))
    await userEvent.type(screen.getByLabelText('כותרת'), 'לנקות חלונות')
    await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
    await userEvent.type(screen.getByLabelText('ערך במטבעות'), '15')
    await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('proposal form submit error shows error and keeps dialog open', async () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } }) })

    renderPoolPage()
    await userEvent.click(screen.getByRole('button', { name: 'הצע משימה' }))
    await userEvent.type(screen.getByLabelText('כותרת'), 'לנקות חלונות')
    await userEvent.clear(screen.getByLabelText('ערך במטבעות'))
    await userEvent.type(screen.getByLabelText('ערך במטבעות'), '15')
    await userEvent.click(screen.getByRole('button', { name: 'שלח הצעה' }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשליחת ההצעה')
  })

  it('shows "ההצעות שלי" section when player has proposals', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUseMyProposals.mockReturnValue({ proposals: [pendingChoreProposal], refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('ההצעות שלי')).toBeInTheDocument()
  })

  it('"ההצעות שלי" section hidden when no proposals', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    renderPoolPage()
    expect(screen.queryByText('ההצעות שלי')).not.toBeInTheDocument()
  })

  it('pending proposal shows "ממתין לאישור" badge', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUseMyProposals.mockReturnValue({ proposals: [pendingChoreProposal], refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('לנקות את החצר')).toBeInTheDocument()
    expect(screen.getByText('ממתין לאישור')).toBeInTheDocument()
  })

  it('rejected proposal shows "נדחה" badge', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUseMyProposals.mockReturnValue({ proposals: [rejectedChoreProposal], refetch: vi.fn() })
    renderPoolPage()
    expect(screen.getByText('לשטוף כלים')).toBeInTheDocument()
    expect(screen.getByText('נדחה')).toBeInTheDocument()
  })

  it('clicking rejected card opens dismissal dialog with rejection reason', async () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUseMyProposals.mockReturnValue({ proposals: [rejectedChoreProposal], refetch: vi.fn() })
    renderPoolPage()
    await userEvent.click(screen.getByText('לשטוף כלים'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/כבר יש משימה דומה/)).toBeInTheDocument()
  })

  it('clicking rejected card without reason shows generic message', async () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUseMyProposals.mockReturnValue({ proposals: [rejectedNoReason], refetch: vi.fn() })
    renderPoolPage()
    await userEvent.click(screen.getByText('לקפל כביסה'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/נדחתה על ידי המנהל/)).toBeInTheDocument()
  })

  it('"אישור" calls dismiss_rejected_proposal RPC and refetches', async () => {
    const mockRefetchProposals = vi.fn()
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUseMyProposals.mockReturnValue({ proposals: [rejectedChoreProposal], refetch: mockRefetchProposals })
    mockRpc.mockResolvedValue({ error: null })

    renderPoolPage()
    await userEvent.click(screen.getByText('לשטוף כלים'))
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('dismiss_rejected_proposal', {
        p_entity_type: 'chore',
        p_entity_id: 'p2',
      })
      expect(mockRefetchProposals).toHaveBeenCalled()
    })
  })

  it('"אישור" RPC error closes dialog but card stays', async () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: vi.fn() })
    mockUseMyProposals.mockReturnValue({ proposals: [rejectedChoreProposal], refetch: vi.fn() })
    mockRpc.mockResolvedValue({ error: { message: 'not found' } })

    renderPoolPage()
    await userEvent.click(screen.getByText('לשטוף כלים'))
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('לשטוף כלים')).toBeInTheDocument()
  })
})
