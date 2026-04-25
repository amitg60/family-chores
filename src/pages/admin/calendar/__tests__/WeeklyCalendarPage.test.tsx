import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { AssignmentWithDetails } from '../../../../hooks/useCalendarAssignments'

const mockRefetch = vi.fn()

vi.mock('../../../../hooks/useCalendarAssignments', () => ({
  useCalendarAssignments: vi.fn(() => ({
    assignments: [],
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))

import { useCalendarAssignments } from '../../../../hooks/useCalendarAssignments'
import AdminCalendarPage from '../WeeklyCalendarPage'

const mockUseCalendarAssignments = vi.mocked(useCalendarAssignments)

const playerAssignment: AssignmentWithDetails = {
  id: 'a1', chore_id: 'c1', user_id: 'u1',
  week_start: '2026-03-29', calendar_day: 3, calendar_slot: 'noon',
  reminder_enabled: false, reminder_sent_at: null, status: 'pending', archived: false, assigned_by: null,
  created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z',
  chores: { title: 'כלים', coin_value: 10, recurrence_type: 'none' },
  profiles: { name: 'דנה', avatar_url: null },
}

function renderPage() {
  return render(<MemoryRouter><AdminCalendarPage /></MemoryRouter>)
}

describe('Admin WeeklyCalendarPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading state', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [], loading: true, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows error message on fetch failure', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [], loading: false, error: 'שגיאה', refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('שגיאה')
  })

  it('renders the calendar grid with day headers', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getAllByText('ראשון').length).toBeGreaterThan(0)
    expect(screen.getAllByText('שבת').length).toBeGreaterThan(0)
  })

  it('shows a player assignment in the correct grid cell', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [playerAssignment], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('כלים')).toBeInTheDocument()
  })

  it('does not render any pin or reminder controls', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [playerAssignment], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.queryByRole('button', { name: 'שנה זמן' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הסר' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'תזכורת' })).not.toBeInTheDocument()
  })
})
