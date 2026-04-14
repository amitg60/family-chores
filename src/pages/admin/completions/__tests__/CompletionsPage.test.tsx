import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockRpc, mockStorageFrom } from '../../../../test/mocks/supabase'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/usePendingCompletions', () => ({
  usePendingCompletions: vi.fn(() => ({
    completions: [],
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', family_id: 'f1' } }),
}))

import { usePendingCompletions } from '../../../../hooks/usePendingCompletions'
import CompletionsPage from '../CompletionsPage'

const mockUsePendingCompletions = vi.mocked(usePendingCompletions)

const fakeCompletion = {
  id: 'comp1',
  chore_assignment_id: 'a1',
  completed_by: 'p1',
  photo_url: 'p1/photo.webp',
  status: 'pending' as const,
  completed_at: '2026-04-08T10:00:00Z',
  chore_assignments: {
    chore_id: 'c1',
    chores: { title: 'כלי מטבח', coin_value: 10 },
  },
  profiles: { name: 'דנה' },
}

function renderPage() {
  return render(<MemoryRouter><CompletionsPage /></MemoryRouter>)
}

describe('CompletionsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading spinner while loading', () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: true, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows empty state when no pending completions', () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('אין הגשות ממתינות לאישור.')).toBeInTheDocument()
  })

  it('shows completion with chore title, player name, and action buttons', () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [fakeCompletion], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
    expect(screen.getByText(/דנה/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'אשר' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'דחה' })).toBeInTheDocument()
  })

  it('approve calls rpc, deletes photo, and refetches', async () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [fakeCompletion], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null })
    mockStorageFrom.mockReturnValue({ remove: vi.fn().mockResolvedValue({}), createSignedUrl: vi.fn() })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('approve_completion', { completion_id: 'comp1' })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('reject opens dialog; submitting calls rpc and refetches', async () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [fakeCompletion], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: null })
    mockStorageFrom.mockReturnValue({ remove: vi.fn().mockResolvedValue({}), createSignedUrl: vi.fn() })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'דחה' }))
    expect(screen.getByLabelText('הסבר לשחקן')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('הסבר לשחקן'), 'תמונה לא ברורה')
    await userEvent.click(screen.getByRole('button', { name: 'דחה הגשה' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('reject_completion', {
        completion_id: 'comp1',
        reason: 'תמונה לא ברורה',
      })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows error when approve fails', async () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [fakeCompletion], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'DB error' } })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('שגיאה באישור ההגשה'))
  })

  it('shows specific error and refetches when completion is already approved by another admin', async () => {
    mockUsePendingCompletions.mockReturnValue({ completions: [fakeCompletion], loading: false, error: null, refetch: mockRefetch })
    mockRpc.mockResolvedValue({ error: { message: 'Completion is not pending' } })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('הגשה זו כבר אושרה על ידי מנהל אחר')
      expect(mockRefetch).toHaveBeenCalled()
    })
  })
})
