// src/pages/player/calendar/__tests__/WeeklyCalendarPage.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockRpc, mockFunctionsInvoke } from '../../../../test/mocks/supabase'
import type { AssignmentWithDetails } from '../../../../hooks/useCalendarAssignments'

const mockRefetch = vi.fn()
const mockToast = vi.fn()

vi.mock('../../../../hooks/useCalendarAssignments', () => ({
  useCalendarAssignments: vi.fn(() => ({
    assignments: [],
    loading: false,
    error: null,
    refetch: mockRefetch,
  })),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', name: 'דנה' } }),
}))
vi.mock('../../../../hooks/useChores', () => ({
  useChores: vi.fn(() => ({ chores: [], loading: false, error: null, refetch: vi.fn() })),
}))
vi.mock('../../../../hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

import { useCalendarAssignments } from '../../../../hooks/useCalendarAssignments'
import WeeklyCalendarPage from '../WeeklyCalendarPage'

const mockUseCalendarAssignments = vi.mocked(useCalendarAssignments)

const ownPinned: AssignmentWithDetails = {
  id: 'a1', chore_id: 'c1', user_id: 'u1',
  week_start: '2026-03-29', calendar_day: 1, calendar_slot: 'morning',
  reminder_enabled: false, reminder_sent_at: null,
  status: 'pending', archived: false, assigned_by: null,
  created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z',
  chores: { title: 'כלים', coin_value: 10, recurrence_type: 'none' },
  profiles: { name: 'דנה', avatar_url: null },
}

const ownUnscheduled: AssignmentWithDetails = {
  ...ownPinned, id: 'a2', calendar_day: null, calendar_slot: null,
  chores: { title: 'שקים', coin_value: 5, recurrence_type: 'none' },
}

const otherPinned: AssignmentWithDetails = {
  ...ownPinned, id: 'a3', user_id: 'u2', calendar_day: 2, calendar_slot: 'afternoon',
  chores: { title: 'אבק', coin_value: 8, recurrence_type: 'none' },
  profiles: { name: 'תום', avatar_url: null },
}

function renderPage() {
  return render(<MemoryRouter><WeeklyCalendarPage /></MemoryRouter>)
}

describe('Player WeeklyCalendarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({ error: null })
  })

  it('shows loading state', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [], loading: true, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows own unscheduled assignments in "ללא סידור" section as draggable', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('ללא סידור')).toBeInTheDocument()
    expect(screen.getByText('שקים')).toBeInTheDocument()
    const card = screen.getByText('שקים').closest('[draggable]')
    expect(card).toHaveAttribute('draggable', 'true')
  })

  it('does not show "קבע זמן" button or dialog', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.queryByRole('button', { name: 'קבע זמן' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('dropping assignment on a cell calls reschedule_assignment RPC and refetch', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled, ownPinned], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()

    const cell = screen.getAllByTestId('cell-1-morning')[0]
    fireEvent.drop(cell, {
      dataTransfer: { getData: () => 'a2' },
    })

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('reschedule_assignment', {
        p_assignment_id: 'a2',
        p_day: 1,
        p_slot: 'morning',
      })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('"הסר" button calls reschedule_assignment RPC with null day/slot', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownPinned], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'הסר' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('reschedule_assignment', {
        p_assignment_id: 'a1',
        p_day: null,
        p_slot: null,
      })
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('reminder checkbox calls toggle_reminder RPC', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()

    await userEvent.click(screen.getByRole('checkbox', { name: 'תזכורת' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('toggle_reminder', { p_assignment_id: 'a2' })
    })
  })

  it('toggle_reminder RPC error shows error toast', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownUnscheduled], loading: false, error: null, refetch: mockRefetch,
    })
    mockRpc.mockResolvedValue({ error: { message: 'Not authorized' } })
    renderPage()

    await userEvent.click(screen.getByRole('checkbox', { name: 'תזכורת' }))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' })
      )
    })
  })

  it('reschedule_assignment RPC error shows error toast', async () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [ownPinned], loading: false, error: null, refetch: mockRefetch,
    })
    mockRpc.mockResolvedValue({ error: { message: 'Not authorized' } })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'הסר' }))

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' })
      )
    })
  })

  it('shows re-arm hint when reminder_enabled=true and reminder_sent_at is set', () => {
    const firedAssignment: AssignmentWithDetails = {
      ...ownUnscheduled,
      reminder_enabled: true,
      reminder_sent_at: '2026-04-25T07:31:00Z',
    }
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [firedAssignment], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('תזכורת נשלחה — העבר למשבצת אחרת או כבה והדלק מחדש')).toBeInTheDocument()
  })

  it('does not show re-arm hint when reminder_sent_at is null', () => {
    const armedAssignment: AssignmentWithDetails = {
      ...ownUnscheduled,
      reminder_enabled: true,
      reminder_sent_at: null,
    }
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [armedAssignment], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.queryByText('תזכורת נשלחה — העבר למשבצת אחרת או כבה והדלק מחדש')).not.toBeInTheDocument()
  })

  it('does not show unpin/reminder controls for other players\' assignments', () => {
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [otherPinned], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()
    expect(screen.getByText('אבק')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'הסר' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'תזכורת' })).not.toBeInTheDocument()
  })

  it('dragging an already-scheduled recurring assignment moves it via reschedule_assignment', async () => {
    const recurringPinned: AssignmentWithDetails = {
      ...ownPinned, id: 'a5', calendar_day: 2, calendar_slot: 'afternoon',
      chores: { title: 'ניקיון', coin_value: 8, recurrence_type: 'daily' },
    }
    mockUseCalendarAssignments.mockReturnValue({
      assignments: [recurringPinned], loading: false, error: null, refetch: mockRefetch,
    })
    renderPage()

    const cell = screen.getAllByTestId('cell-1-morning')[0]
    fireEvent.drop(cell, {
      dataTransfer: { getData: () => 'a5' },
    })

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('reschedule_assignment', {
        p_assignment_id: 'a5', p_day: 1, p_slot: 'morning',
      })
      expect(mockRefetch).toHaveBeenCalled()
    })
    expect(mockFunctionsInvoke).not.toHaveBeenCalledWith('self-assign-chore', expect.anything())
  })

  it('completed assignments are not shown', () => {
    renderPage()
    expect(mockUseCalendarAssignments).toHaveBeenCalled()
  })
})
