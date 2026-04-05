import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom } from '../../../../test/mocks/supabase'
import type { FeedbackWithProfile } from '../../../../hooks/useFeedback'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useFeedback', () => ({
  useFeedback: vi.fn(() => ({ feedback: [], loading: false, error: null, refetch: mockRefetch })),
}))

import { useFeedback } from '../../../../hooks/useFeedback'
import FeedbackDashboard from '../FeedbackDashboard'

const mockUseFeedback = vi.mocked(useFeedback)

const fakeFeedback: FeedbackWithProfile = {
  id: 'fb1',
  user_id: 'u1',
  family_id: 'f1',
  category: 'bug',
  areas: ['chores'],
  star_rating: 4,
  mood: 'happy',
  free_text: 'יופי',
  noted: false,
  resolved: false,
  created_at: '2026-04-04T10:00:00Z',
  profiles: { name: 'דנה' },
}

const resolvedFeedback: FeedbackWithProfile = {
  ...fakeFeedback,
  id: 'fb2',
  mood: 'frustrated',
  star_rating: 2,
  noted: true,
  resolved: true,
}

function renderPage() {
  return render(<MemoryRouter><FeedbackDashboard /></MemoryRouter>)
}

describe('FeedbackDashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading state', () => {
    mockUseFeedback.mockReturnValue({ feedback: [], loading: true, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows error state', () => {
    mockUseFeedback.mockReturnValue({ feedback: [], loading: false, error: 'שגיאה', refetch: mockRefetch })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאה')
  })

  it('shows empty state when no feedback', () => {
    mockUseFeedback.mockReturnValue({ feedback: [], loading: false, error: null, refetch: mockRefetch })
    renderPage()
    expect(screen.getByText('אין משוב עדיין.')).toBeInTheDocument()
  })

  it('shows average star rating', () => {
    mockUseFeedback.mockReturnValue({
      feedback: [fakeFeedback, resolvedFeedback], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    // Average of 4 and 2 = 3.0
    expect(screen.getByText(/3\.0/)).toBeInTheDocument()
  })

  it('shows mood distribution counts', () => {
    mockUseFeedback.mockReturnValue({
      feedback: [fakeFeedback, resolvedFeedback], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    // 1 happy, 0 neutral, 1 frustrated out of 2 total
    expect(screen.getByText(/😊.*1/s)).toBeInTheDocument()
    expect(screen.getByText(/😤.*1/s)).toBeInTheDocument()
  })

  it('shows feedback submitter name and category', () => {
    mockUseFeedback.mockReturnValue({
      feedback: [fakeFeedback], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('דנה')).toBeInTheDocument()
    expect(screen.getByText('באג')).toBeInTheDocument()
  })

  it('"סמן כנלקח בחשבון" calls update and refetches', async () => {
    mockUseFeedback.mockReturnValue({
      feedback: [fakeFeedback], loading: false, error: null, refetch: mockRefetch,
    })
    const mockUpdateFn = vi.fn().mockReturnThis()
    const mockEqFn = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ update: mockUpdateFn, eq: mockEqFn })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'סמן כנלקח בחשבון' }))

    await waitFor(() => {
      expect(mockUpdateFn).toHaveBeenCalledWith({ noted: true })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('"סמן כטופל" calls update with resolved and refetches', async () => {
    mockUseFeedback.mockReturnValue({
      feedback: [fakeFeedback], loading: false, error: null, refetch: mockRefetch,
    })
    const mockUpdateFn = vi.fn().mockReturnThis()
    const mockEqFn = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ update: mockUpdateFn, eq: mockEqFn })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'סמן כטופל' }))

    await waitFor(() => {
      expect(mockUpdateFn).toHaveBeenCalledWith({ resolved: true })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('shows error when "סמן כנלקח בחשבון" fails', async () => {
    mockUseFeedback.mockReturnValue({
      feedback: [fakeFeedback], loading: false, error: null, refetch: mockRefetch,
    })
    const mockUpdateFn = vi.fn().mockReturnThis()
    const mockEqFn = vi.fn().mockResolvedValue({ error: { message: 'DB error' } })
    mockFrom.mockReturnValue({ update: mockUpdateFn, eq: mockEqFn })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'סמן כנלקח בחשבון' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בעדכון')
      expect(mockRefetch).not.toHaveBeenCalled()
    })
  })

  it('hides "סמן כנלקח בחשבון" for already-noted items', () => {
    mockUseFeedback.mockReturnValue({
      feedback: [resolvedFeedback], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.queryByRole('button', { name: 'סמן כנלקח בחשבון' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'סמן כטופל' })).not.toBeInTheDocument()
  })
})
