import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: mockRefetch })),
}))
vi.mock('../../../../hooks/useFamilyMembers', () => ({
  useFamilyMembers: vi.fn(() => ({ members: [], loading: false, error: null })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', family_id: 'f1' } }),
}))

import { useChores } from '../../../../hooks/useChores'
import { useFamilyMembers } from '../../../../hooks/useFamilyMembers'
import ChoresPage from '../ChoresPage'

const mockUseChores = vi.mocked(useChores)
const mockUseFamilyMembers = vi.mocked(useFamilyMembers)

const activeChore = {
  id: 'c1', family_id: 'f1', title: 'כלי מטבח', description: null,
  coin_value: 10, difficulty: 'easy' as const, assigned_to: null,
  recurrence_type: 'none' as const, status: 'active' as const,
  proposed_by: null, approved_by: null, due_date: null,
  last_traded_price: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const pendingChore = {
  ...activeChore,
  id: 'c2',
  title: 'ניקוי חדר',
  status: 'pending_approval' as const,
  proposed_by: 'player-1',
}

function renderChoresPage() {
  return render(<MemoryRouter><ChoresPage /></MemoryRouter>)
}

describe('ChoresPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFamilyMembers.mockReturnValue({ members: [], loading: false, error: null, refetch: vi.fn() })
  })

  it('shows loading spinner while loading', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: true, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no active chores', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByText('אין משימות פעילות')).toBeInTheDocument()
  })

  it('shows active chore title and coin value', () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
    expect(screen.getByText(/10 מטבעות/)).toBeInTheDocument()
  })

  it('shows pending proposal section with approve and reject buttons', () => {
    mockUseChores.mockReturnValue({ chores: [pendingChore], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByText('ניקוי חדר')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'אשר' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'דחה' })).toBeInTheDocument()
  })

  it('archive button calls supabase update with status archived and refetches', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'ארכיון' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'archived' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('approve button sets status to active and refetches', async () => {
    mockUseChores.mockReturnValue({ chores: [pendingChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('reject button sets status to archived and refetches', async () => {
    mockUseChores.mockReturnValue({ chores: [pendingChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'archived' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows delete button for each active chore', () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByRole('button', { name: 'מחק' })).toBeInTheDocument()
  })

  it('clicking delete button opens confirmation dialog with chore title', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'מחק' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText(/כלי מטבח/)).toBeInTheDocument()
  })

  it('confirming delete calls supabase update with status deleted and refetches', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'מחק' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'מחק' }))

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'deleted' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('cancelling dialog does not call supabase update', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'מחק' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ביטול' }))
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('shows error alert when delete mutation fails', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'מחק' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'מחק' }))

    await waitFor(() => {
      expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('שגיאה במחיקת המשימה')
      expect(mockRefetch).not.toHaveBeenCalled()
    })
  })

  it('shows link to create new chore', () => {
    mockUseChores.mockReturnValue({ chores: [], loading: false, error: null, refetch: mockRefetch })
    renderChoresPage()
    expect(screen.getByRole('link', { name: 'משימה חדשה' })).toBeInTheDocument()
  })

  it('shows error message when archive mutation fails', async () => {
    mockUseChores.mockReturnValue({ chores: [activeChore], loading: false, error: null, refetch: mockRefetch })
    const mockEq = vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ update: mockUpdate })

    renderChoresPage()
    await userEvent.click(screen.getByRole('button', { name: 'ארכיון' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בארכוב המשימה')
      expect(mockRefetch).not.toHaveBeenCalled()
    })
  })
})
